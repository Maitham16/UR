import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import {
  formatLocalFirstProfile,
  localFirstProfile,
} from '../../utils/offlineMode.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const profile = localFirstProfile(getCwd())
  return {
    type: 'text',
    value: formatLocalFirstProfile(profile, tokens.includes('--json')),
  }
}
