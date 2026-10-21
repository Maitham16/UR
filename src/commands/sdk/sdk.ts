import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

const TS_EXAMPLE = `// npm install ur-agent in your project; the installed native ur executable runs the task.
import { UrClient } from 'ur-agent/sdk'
const model = process.env.UR_MODEL
if (!model) throw new Error('Set UR_MODEL to a model available from your configured provider')
const client = new UrClient({ model, maxTurns: 4, ...(process.env.UR_EXECUTABLE ? { bin: { file: process.env.UR_EXECUTABLE } } : {}) })
const result = await client.query('Summarize the README in one sentence')
if (!result.ok) throw new Error(result.error)
console.log(result.text)
`

const PY_EXAMPLE = `"""Install the bundled SDK with python3 -m pip install /path/to/ur-agent/sdk/python."""
import os
from ur_agent import UrClient
model = os.environ.get("UR_MODEL")
if not model:
    raise RuntimeError("Set UR_MODEL to a model available from your configured provider")
result = UrClient(model=model, max_turns=4).query("Summarize the README in one sentence")
if not result.ok:
    raise RuntimeError(result.error)
print(result.text)
`

const README = `# Supported UR SDK examples

Install the Node client in your project with \`npm install ur-agent\`, then run
\`example.ts\` in a TypeScript-capable Node runtime. The public \`ur-agent/sdk\`
entry provides \`UrClient\`, \`query\`, \`stream\`, and \`UrRemoteClient\`.
The SDK uses Node built-ins; the installed native UR executable includes its
own runtime. No separate Bun installation is required.

Install the bundled standard-library Python client from
\`$(npm root)/ur-agent/sdk/python\` with \`python3 -m pip install <path>\`.
Python 3.10+ is required. A separately published PyPI package is not assumed.

Set UR_MODEL and optionally UR_EXECUTABLE, then run example.ts or example.py.
Local macOS/Linux runs use the same CLI configuration, model choice and
permissions. query declines interactive permission requests unless its caller
provides a permission callback; stream exposes requests for explicit decisions.
Both SDKs support events, cancellation and native session resume.

For remote control, use the authenticated canonical \`ur acp serve\` HTTP
endpoint and UrRemoteClient / Python RemoteClient. Persist sessionId and the
last observed sequence to reconnect without resubmitting a prompt. Remote
approval decisions are allow_once/deny. A2A remains available for task handoff.

See technical/11-integrations.md and the package SDK documentation for the full
wire revision 1 contract, bounds, errors and examples.
`

function infoText(): string {
  return [
    'UR SDK — supported Node/TypeScript and Python clients.',
    '',
    'Node: npm install ur-agent; import { UrClient } from "ur-agent/sdk"',
    'Python: python3 -m pip install <ur-agent package>/sdk/python',
    'Local: events, explicit approvals, cancel and native session resume.',
    'Remote: authenticated canonical ur acp serve HTTP transport with event cursors.',
    'No runtime library dependencies; native UR includes its runtime on macOS/Linux.',
    'Set UR_MODEL and optionally UR_EXECUTABLE for the generated examples.',
    'Scaffold examples into .ur/sdk/: ur sdk init',
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
