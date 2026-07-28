import {
  DRILLS,
  formatDrills,
  runAutomatedDrills,
} from '../../services/agents/selfTest.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'

export const call: LocalCommandCall = async args => {
  const tokens = parseArguments(args ?? '')
  const json = tokens.includes('--json')
  const action = tokens.find(token => !token.startsWith('--')) ?? 'run'

  if (action === 'list') {
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ drills: DRILLS }, null, 2)
        : formatDrills([], false),
    }
  }

  const results = runAutomatedDrills()
  // A self-test that cannot fail is decoration.
  if (results.some(result => !result.passed)) process.exitCode = 1
  return { type: 'text', value: formatDrills(results, json) }
}
