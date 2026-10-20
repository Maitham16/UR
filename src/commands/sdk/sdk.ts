import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

const TS_EXAMPLE = `// Drive installed UR headlessly from a TypeScript-capable Node.js/Bun runtime.
// Requires the global \`ur\` binary on PATH and an explicit model choice.
import { execFileSync } from 'node:child_process'

const model = process.env.UR_MODEL
if (!model) throw new Error('Set UR_MODEL to a model available from your configured provider')
const executable = process.env.UR_EXECUTABLE ?? (process.platform === 'win32' ? 'ur.exe' : 'ur')
const output = execFileSync(executable, [
  '-p', '--model', model, '--max-turns', '4', '--output-format', 'json',
  'Summarize the README in one sentence',
], { encoding: 'utf8', timeout: 1800000, maxBuffer: 64 * 1024 * 1024 })
const result = JSON.parse(output)
console.log(result.result ?? result.text ?? output)
`

const PY_EXAMPLE = `"""UR SDK (Python) — a thin wrapper over headless \`ur -p\`.

No third-party dependencies; shells out to the installed \`ur\` binary.
"""
import json
import subprocess
from typing import Optional


def query(prompt: str, *, model: Optional[str] = None, max_turns: Optional[int] = None,
          output_format: str = "json", cwd: Optional[str] = None, timeout: int = 1800) -> str:
    args = ["ur", "-p", "--output-format", output_format]
    if max_turns:
        args += ["--max-turns", str(max_turns)]
    args.append(prompt)
    env = None
    if model:
        import os
        env = {**os.environ, "UR_MODEL": model}
    proc = subprocess.run(args, capture_output=True, text=True, cwd=cwd, env=env, timeout=timeout)
    out = proc.stdout.strip()
    try:
        parsed = json.loads(out)
        if isinstance(parsed, dict):
            return parsed.get("result") or parsed.get("text") or out
    except json.JSONDecodeError:
        pass
    return out


if __name__ == "__main__":
    print(query("Summarize the README in one sentence", max_turns=4))
`

const README = `# UR SDK examples

These show how to call UR programmatically. Both wrap headless mode
(\`ur -p --output-format json\`), so they inherit the same permission model,
MCP configuration, and local Ollama routing as the interactive CLI.

- \`example.ts\` — TypeScript, using the calling program's Node.js/Bun runtime
  and built-in child-process API. Set \`UR_MODEL\` before running it.
  Windows native installations provide \`ur.exe\` on PATH. Set \`UR_EXECUTABLE\`
  to its full path when the installed launcher directory is absent from PATH.
- \`example.py\` — Python, no dependencies, shells out to \`ur\`.

There is no separately published \`ur-agent/sdk\` package entry. Native UR
itself includes its runtime; these external calling programs use their own.

For agent-to-agent hand-off over HTTP instead of in-process scripting, use the
A2A server: \`ur a2a serve\`.
`

function infoText(): string {
  return [
    'UR SDK — drive UR programmatically (headless).',
    '',
    'TypeScript:',
    "  import { execFileSync } from 'node:child_process'",
    "  const executable = process.env.UR_EXECUTABLE ?? (process.platform === 'win32' ? 'ur.exe' : 'ur')",
    "  const output = execFileSync(executable, ['-p', '--model', '<model>', '--output-format', 'json', 'Fix the failing test'])",
    '',
    'Python (no deps): shell out to `ur -p --output-format json` (see example.py).',
    '',
    'Both reuse the CLI permission model, MCP config, and local Ollama routing.',
    'External calling programs use their own runtime; native UR includes its runtime.',
    'Windows native installs provide ur.exe on PATH; UR_EXECUTABLE can override its path.',
    'For HTTP agent-to-agent hand-off instead, use `ur a2a serve`.',
    '',
    'Scaffold runnable examples into .ur/sdk/ with:  ur sdk init',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const force = tokens.includes('--force')
  const action = tokens.find(token => !token.startsWith('--')) ?? 'info'

  if (action === 'init') {
    const root = join(getCwd(), '.ur', 'sdk')
    mkdirSync(root, { recursive: true })
    const files: Array<[string, string]> = [
      ['example.ts', TS_EXAMPLE],
      ['example.py', PY_EXAMPLE],
      ['README.md', README],
    ]
    const created: string[] = []
    const skipped: string[] = []
    for (const [name, content] of files) {
      const path = join(root, name)
      if (!force && existsSync(path)) {
        skipped.push(name)
        continue
      }
      writeFileSync(path, content)
      created.push(name)
    }
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ root, created, skipped }, null, 2)
        : `SDK examples ready at ${root}\ncreated: ${created.join(', ') || 'none'}${skipped.length ? `\nkept existing: ${skipped.join(', ')}` : ''}`,
    }
  }

  return { type: 'text', value: json ? JSON.stringify({ info: infoText() }, null, 2) : infoText() }
}
