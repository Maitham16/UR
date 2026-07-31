import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { indexWorkspace } from '../../ur/fileops.js'
export const call: LocalCommandCall = async () => {
  const r = indexWorkspace(getCwd())
  return { type: 'text', value: `indexed ${r.count} file(s) → .ur/index/files.txt\n\nsample:\n` + r.sample.map((s) => `  ${s}`).join('\n') }
}
