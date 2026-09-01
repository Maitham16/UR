import type { Command, LocalCommandCall } from '../../types/command.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

type AssistantAction = 'on' | 'off' | 'status' | 'toggle'

function parseAction(args: string): AssistantAction | null {
  const action = args.trim().toLowerCase()
  if (action === '') return 'toggle'
  if (action === 'on' || action === 'enable') return 'on'
  if (action === 'off' || action === 'disable') return 'off'
  if (action === 'status') return 'status'
  return null
}

export const call: LocalCommandCall = async args => {
  const action = parseAction(args)
  if (action === null) {
    return { type: 'text', value: 'Usage: /assistant [on|off|status]' }
  }

  const enabled = getInitialSettings().assistant === true
  if (action === 'status') {
    return {
      type: 'text',
      value: `Assistant mode is ${enabled ? 'enabled' : 'disabled'} in .ur/settings.local.json.`,
    }
  }

  const next = action === 'on' || (action === 'toggle' && !enabled)
  const { error } = updateSettingsForSource('localSettings', {
    assistant: next,
  })
  if (error) {
    return {
      type: 'text',
      value: `Could not update assistant mode: ${error.message}`,
    }
  }

  return {
    type: 'text',
    value: `Assistant mode ${next ? 'enabled' : 'disabled'}. Restart UR to apply the change.`,
  }
}

const assistant = {
  type: 'local',
  name: 'assistant',
  description: 'Enable or disable persistent assistant mode for this project',
  argumentHint: '[on|off|status]',
  supportsNonInteractive: false,
  // commands.ts only loads this module in a feature('KAIROS') branch. Keeping
  // feature() out of callbacks is important: Bun can only lower feature calls
  // that appear directly in a build-time conditional.
  isEnabled: () => true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default assistant
