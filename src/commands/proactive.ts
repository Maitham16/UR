import type {
  Command,
  LocalJSXCommandOnDone,
} from '../types/command.js'
import {
  activateProactive,
  deactivateProactive,
  getActivationSource,
  isProactiveActive,
  isProactivePaused,
} from '../proactive/index.js'

function normalizeAction(args: string): 'on' | 'off' | 'status' | 'toggle' | null {
  const action = args.trim().toLowerCase()
  if (action === '') return 'toggle'
  if (action === 'on' || action === 'enable') return 'on'
  if (action === 'off' || action === 'disable') return 'off'
  if (action === 'status') return 'status'
  return null
}

async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args = '',
): Promise<React.ReactNode> {
  const action = normalizeAction(args)
  if (action === null) {
    onDone('Usage: /proactive [on|off|status]', { display: 'system' })
    return null
  }

  if (action === 'status') {
    const status = !isProactiveActive()
      ? 'disabled'
      : isProactivePaused()
        ? 'paused'
        : 'enabled'
    const source = getActivationSource()
    onDone(
      `Proactive mode is ${status}${source ? ` (source: ${source})` : ''}`,
      { display: 'system' },
    )
    return null
  }

  const enable = action === 'on' || (action === 'toggle' && !isProactiveActive())
  if (enable) {
    activateProactive('slash-command')
    onDone('Proactive mode enabled', {
      display: 'system',
      metaMessages: [
        '<system-reminder>Proactive mode is now enabled. Continue working autonomously; use Sleep when there is no useful work and remain responsive to user input.</system-reminder>',
      ],
    })
  } else {
    deactivateProactive()
    onDone('Proactive mode disabled', {
      display: 'system',
      metaMessages: [
        '<system-reminder>Proactive mode is now disabled. Do not continue work solely because of automatic tick prompts.</system-reminder>',
      ],
    })
  }
  return null
}

const proactive = {
  type: 'local-jsx',
  name: 'proactive',
  description: 'Toggle autonomous proactive work',
  argumentHint: '[on|off|status]',
  immediate: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default proactive
