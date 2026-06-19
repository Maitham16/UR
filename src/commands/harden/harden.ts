import { handleSecurityCommand } from '../../security/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
export const call: LocalCommandCall = async (args: string) => {
  const toks = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const value = await handleSecurityCommand(['security','harden', ...toks], getCwd())
  return { type: 'text', value }
}
