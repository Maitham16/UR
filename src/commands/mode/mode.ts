import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { handleSecurityCommand } from '../../security/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

const MODES = ['code', 'research', 'debug', 'browser', 'image', 'video', 'data']
// Security modes are handled by the security module (which enforces the safety boundary).
const SECURITY_MODES = ['security', 'audit', 'blue-team', 'purple-team', 'pentest-lab', 'hardening', 'incident-response', 'secure-code']
const file = (cwd: string) => join(cwd, '.ur', 'mode')

export const call: LocalCommandCall = async (args: string) => {
  const want = (args ?? '').trim().toLowerCase()
  const f = file(getCwd())
  if (!want) {
    const cur = existsSync(f) ? readFileSync(f, 'utf8').trim() : 'code'
    return { type: 'text', value: `mode: ${cur}\navailable: ${MODES.join(', ')}\nsecurity: ${SECURITY_MODES.join(', ')}` }
  }
  // Security modes delegate to the security subsystem (keeps the safety boundary intact).
  if (SECURITY_MODES.includes(want)) {
    return { type: 'text', value: await handleSecurityCommand(['mode', want], getCwd()) }
  }
  if (!MODES.includes(want)) {
    return { type: 'text', value: `unknown mode "${want}"\navailable: ${MODES.join(', ')}\nsecurity: ${SECURITY_MODES.join(', ')}` }
  }
  try {
    mkdirSync(join(getCwd(), '.ur'), { recursive: true })
    writeFileSync(f, want + '\n')
  } catch {
    /* best-effort */
  }
  return { type: 'text', value: `mode → ${want} (UR will favor ${want}-oriented behavior; persisted to .ur/mode)` }
}
