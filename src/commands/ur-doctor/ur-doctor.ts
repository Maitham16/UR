import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { collectReadiness, formatReadiness } from '../../services/readiness.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
export const call: LocalCommandCall = async args => ({ type: 'text',
  value: formatReadiness(await collectReadiness(getCwd()), parseArguments(args).includes('--json')) })
