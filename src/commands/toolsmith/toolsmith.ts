import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { commandExists } from '../../ur/sysinfo.js'

const TEMPLATES: Record<string, { ext: string; body: string }> = {
  python: { ext: 'py', body: '#!/usr/bin/env python3\n"""UR helper tool."""\n\n\ndef main() -> None:\n    print("hello from UR toolsmith")\n\n\nif __name__ == "__main__":\n    main()\n' },
  bash: { ext: 'sh', body: '#!/usr/bin/env bash\nset -euo pipefail\necho "hello from UR toolsmith"\n' },
  node: { ext: 'js', body: '#!/usr/bin/env node\nconsole.log("hello from UR toolsmith")\n' },
  go: { ext: 'go', body: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello from UR toolsmith")\n}\n' },
  rust: { ext: 'rs', body: 'fn main() {\n    println!("hello from UR toolsmith");\n}\n' },
}

export const call: LocalCommandCall = async (args: string) => {
  const [name, langArg] = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const auto = [['python3', 'python'], ['node', 'node'], ['bash', 'bash'], ['go', 'go'], ['cargo', 'rust']].find(([bin]) => commandExists(bin))?.[1] ?? 'python'
  const lang = langArg ?? auto
  const dir = join(getCwd(), '.ur', 'tools')
  if (!name) {
    const files = existsSync(dir) ? readdirSync(dir) : []
    return { type: 'text', value: files.length ? 'tools:\n' + files.map((f) => '  ' + f).join('\n') : 'no tools yet. usage: /toolsmith <name> <python|bash|node|go|rust>' }
  }
  const tpl = TEMPLATES[lang]
  if (!tpl) return { type: 'text', value: `unknown lang "${lang}". choose: ${Object.keys(TEMPLATES).join(', ')}` }
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.${tpl.ext}`)
  if (existsSync(file)) return { type: 'text', value: `already exists: .ur/tools/${name}.${tpl.ext}` }
  writeFileSync(file, tpl.body)
  return { type: 'text', value: `created .ur/tools/${name}.${tpl.ext}\nAsk UR to run it — it will request approval before executing, and you can keep it as a plugin if useful.` }
}
