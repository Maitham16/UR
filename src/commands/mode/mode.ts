import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import { handleSecurityCommand } from '../../security/index.js'
import {
  isWorkingMode,
  loadWorkingMode,
  saveWorkingMode,
  WORKING_MODES,
} from '../../services/agents/workingMode.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

// Security modes are handled by the security module (which enforces the safety boundary).
const SECURITY_MODES = ['security', 'audit', 'blue-team', 'purple-team', 'pentest-lab', 'hardening', 'incident-response', 'secure-code']

export const call: LocalCommandCall = async (args: string) => {
  const want = (args ?? '').trim().toLowerCase()
  const cwd = getCwd()
  if (!want) {
    const cur = loadWorkingMode(cwd)
    return { type: 'text', value: `mode: ${cur}\navailable: ${WORKING_MODES.join(', ')}\nsecurity: ${SECURITY_MODES.join(', ')}` }
  }
  // Security modes delegate to the security subsystem (keeps the safety boundary intact).
  if (SECURITY_MODES.includes(want)) {
    return { type: 'text', value: await handleSecurityCommand(['mode', want], cwd) }
  }
  if (!isWorkingMode(want)) {
    return {
      type: 'text',
      value: `unknown mode "${want}"\navailable: ${WORKING_MODES.join(', ')}\nsecurity: ${SECURITY_MODES.join(', ')}`,
      exitCode: 2,
    }
  }
  try {
    saveWorkingMode(cwd, want)
    clearSystemPromptSections()
  } catch (error) {
    return {
      type: 'text',
      value: `Failed to set mode: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    }
  }
  return { type: 'text', value: `mode → ${want} (active in the agent system prompt; persisted to .ur/mode)` }
}
