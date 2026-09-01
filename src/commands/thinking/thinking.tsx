import * as React from 'react'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { ProviderId } from '../../services/providers/providerRegistry.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { modelSupportsEffort } from '../../utils/effort.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getRuntimeProvider } from '../../utils/model/providers.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import {
  modelSupportsThinking,
  providerSupportsThinkingToggle,
} from '../../utils/thinking.js'

export type ThinkingCommandResult = {
  message: string
  thinkingUpdate?: { value: boolean }
}

function capabilityMessage(
  enabled: boolean,
  model: string,
  provider: ProviderId,
): string {
  if (!modelSupportsThinking(model, provider)) {
    return `${model} on ${provider} does not advertise thinking, so UR will not send a thinking control to it.`
  }
  if (!providerSupportsThinkingToggle(provider)) {
    return `${model} advertises thinking, but the ${provider} runtime has no provider-native on/off mapping. ${modelSupportsEffort(model, provider) ? 'Use /effort for its advertised graded control.' : 'UR will not invent a boolean wire field.'}`
  }
  if (!modelSupportsEffort(model, provider)) {
    return `${model} on ${provider} accepts thinking on/off only; no graded effort is sent.`
  }
  return enabled
    ? `${model} on ${provider} also advertises graded effort; use /effort status to inspect its independently selected level.`
    : `${model} on ${provider} also advertises graded effort, which remains independently controlled by /effort.`
}

function persistThinking(enabled: boolean): Error | undefined {
  const result = updateSettingsForSource('userSettings', {
    // `undefined` follows UR's thinking-on default. `false` is the explicit
    // durable override, so this command changes both this and future sessions.
    alwaysThinkingEnabled: enabled ? undefined : false,
  })
  return result.error
}

export function executeThinking(
  args: string,
  currentEnabled: boolean,
  model: string,
  provider: ProviderId = getRuntimeProvider(),
): ThinkingCommandResult {
  const normalized = args.trim().toLowerCase()
  if (!normalized || normalized === 'status' || normalized === 'current') {
    const disabledByEnvironment = isEnvTruthy(
      process.env.UR_CODE_DISABLE_THINKING,
    )
    const statusLabel =
      modelSupportsThinking(model, provider) &&
      providerSupportsThinkingToggle(provider)
        ? 'Thinking'
        : 'Thinking preference'
    return {
      message: disabledByEnvironment && currentEnabled
        ? `Thinking preference: ON, but UR_CODE_DISABLE_THINKING disables it for this session. ${capabilityMessage(false, model, provider)}`
        : `${statusLabel}: ${currentEnabled ? 'ON' : 'OFF'}. ${capabilityMessage(currentEnabled, model, provider)}`,
    }
  }

  let enabled: boolean
  if (normalized === 'on' || normalized === 'enable' || normalized === 'enabled' || normalized === 'true') {
    enabled = true
  } else if (normalized === 'off' || normalized === 'disable' || normalized === 'disabled' || normalized === 'false') {
    enabled = false
  } else if (normalized === 'toggle') {
    enabled = !currentEnabled
  } else {
    return {
      message: `Invalid argument: ${args}. Valid options are: on, off, toggle, status`,
    }
  }

  const error = persistThinking(enabled)
  if (error) {
    return { message: `Failed to set thinking: ${error.message}` }
  }
  logEvent('tengu_thinking_toggled_hotkey', {
    enabled,
    source: 'slash-command' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  const disabledByEnvironment =
    enabled && isEnvTruthy(process.env.UR_CODE_DISABLE_THINKING)
  const appliesToActiveModel =
    modelSupportsThinking(model, provider) &&
    providerSupportsThinkingToggle(provider) &&
    !disabledByEnvironment
  return {
    message: disabledByEnvironment
      ? `Thinking preference saved as ON, but UR_CODE_DISABLE_THINKING disables it for this session. ${capabilityMessage(false, model, provider)}`
      : `${appliesToActiveModel ? 'Thinking' : 'Thinking preference'} ${enabled ? 'ON' : 'OFF'} for this session; user preference saved. ${capabilityMessage(enabled, model, provider)}`,
    thinkingUpdate: { value: enabled },
  }
}

function ApplyThinkingAndClose({
  args,
  onDone,
}: {
  args: string
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const currentEnabled = useAppState(state => state.thinkingEnabled !== false)
  const model = useMainLoopModel()
  const provider = getRuntimeProvider()
  const setAppState = useSetAppState()
  const applied = React.useRef(false)

  React.useEffect(() => {
    if (applied.current) return
    applied.current = true
    const result = executeThinking(args, currentEnabled, model, provider)
    if (result.thinkingUpdate) {
      setAppState(previous => ({
        ...previous,
        thinkingEnabled: result.thinkingUpdate!.value,
      }))
    }
    onDone(result.message)
  }, [args, currentEnabled, model, onDone, provider, setAppState])
  return null
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args = '',
): Promise<React.ReactNode> {
  const normalized = args.trim().toLowerCase()
  if (normalized === 'help' || normalized === '-h' || normalized === '--help') {
    onDone(
      'Usage: /thinking [on|off|toggle|status]\n\nControls provider-native thinking independently from graded effort when the active adapter has a real on/off mapping. Generic OpenAI-compatible runtimes never receive an invented boolean field. Use /effort for models that advertise a graded ladder.',
    )
    return null
  }
  return <ApplyThinkingAndClose args={args} onDone={onDone} />
}
