import { handleStabilityCommand } from '../../stability/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

export const call: LocalCommandCall = async (args: string) => {
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const value = await handleStabilityCommand(['stability', 'actions', ...tokens], getCwd())
  return { type: 'text', value }
}
