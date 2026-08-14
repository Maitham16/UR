import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { handleSecurityCommand } from '../../security/index.js'
import {
  acceptRedteamWarning,
  activateRedteamMode,
  deactivateRedteamMode,
  hasAcceptedRedteamWarning,
  isRedteamModeActive,
  REDTEAM_WARNING,
} from '../../security/redteamMode.js'
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
    const cur = isRedteamModeActive()
      ? 'redteam (session only)'
      : existsSync(f)
        ? readFileSync(f, 'utf8').trim()
        : 'code'
    return { type: 'text', value: `mode: ${cur}\navailable: ${MODES.join(', ')}, redteam\nsecurity: ${SECURITY_MODES.join(', ')}` }
  }
  if (want === 'redteam off') {
    deactivateRedteamMode()
    return { type: 'text', value: 'redteam mode off' }
  }
  if (want === 'redteam' || want === 'redteam --accept-risk') {
    if (!hasAcceptedRedteamWarning() && want !== 'redteam --accept-risk') {
      return { type: 'text', value: REDTEAM_WARNING }
    }
    if (want === 'redteam --accept-risk') {
      const result = acceptRedteamWarning()
      if (result.error) {
        return {
          type: 'text',
          value: `Could not save the redteam warning acknowledgement: ${result.error.message}`,
        }
      }
    }
    activateRedteamMode()
    return {
      type: 'text',
      value:
        'mode → redteam (this session only)\nUR content restrictions for security research are disabled. Target scope, approvals, permissions, sandboxing, and audit controls remain active. The selected model/provider keeps its own policies.\nSet an engagement target with `/scope set ...`, then approve it with `/scope approve` before active testing.',
    }
  }
  // Security modes delegate to the security subsystem (keeps the safety boundary intact).
  if (SECURITY_MODES.includes(want)) {
    deactivateRedteamMode()
    return { type: 'text', value: await handleSecurityCommand(['mode', want], getCwd()) }
  }
  if (!MODES.includes(want)) {
    return { type: 'text', value: `unknown mode "${want}"\navailable: ${MODES.join(', ')}\nsecurity: ${SECURITY_MODES.join(', ')}` }
  }
  deactivateRedteamMode()
  try {
    mkdirSync(join(getCwd(), '.ur'), { recursive: true })
    writeFileSync(f, want + '\n')
  } catch {
    /* best-effort */
  }
  return { type: 'text', value: `mode → ${want} (UR will favor ${want}-oriented behavior; persisted to .ur/mode)` }
}
