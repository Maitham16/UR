/**
 * /security implementation. Dispatches to the self-contained security module
 * (ported from the 309 agent). Subcommands:
 *   scan, code, secrets, attack-surface, dependencies, classify, status, rules,
 *   report, scope ..., mode ..., threat-model, vuln, net, ir, attack,
 *   compliance, playbook(s), lab, secure-design|api|ci|docker|deploy
 */
import { handleSecurityCommand } from '../../security/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

// Heads the underlying dispatcher recognizes directly; anything else is treated
// as a subcommand of `security` (so `/security scan` works as expected).
const TOP_LEVEL = new Set([
  'security', 'mode', 'scope', 'net', 'vuln', 'ir', 'attack', 'threat-model',
  'compliance', 'playbook', 'playbooks', 'lab', 'doctor', 'kali',
  'secure-design', 'secure-api', 'secure-ci', 'secure-docker', 'secure-deploy',
])

export const call: LocalCommandCall = async (args: string) => {
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const head = tokens[0] ?? ''
  const callTokens = TOP_LEVEL.has(head) ? tokens : ['security', ...tokens]
  const value = await handleSecurityCommand(callTokens, getCwd())
  return { type: 'text', value }
}
