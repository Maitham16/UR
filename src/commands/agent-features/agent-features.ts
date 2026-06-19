import {
  formatAgentFeatureList,
  formatScaffoldResult,
  scaffoldAgentFeatures,
} from '../../services/agents/featureScaffolds.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const force = tokens.includes('--force')
  const init = tokens.includes('init') || tokens.includes('--init')

  if (init) {
    const result = scaffoldAgentFeatures(getCwd(), { force })
    if (json) {
      return { type: 'text', value: JSON.stringify(result, null, 2) }
    }
    return { type: 'text', value: formatScaffoldResult(result) }
  }

  return { type: 'text', value: formatAgentFeatureList(json) }
}
