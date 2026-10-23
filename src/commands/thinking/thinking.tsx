import * as React from 'react'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getActiveProviderSettings, getProviderReasoningCapabilitiesForModel, type ProviderId, type ProviderSettings } from '../../services/providers/providerRegistry.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { modelSupportsEffort, getDefaultEffortForModel, getDisplayedEffortLevel, getProviderEffortWireValue, getSupportedEffortLevelsForModel, type EffortValue } from '../../utils/effort.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getRuntimeProvider } from '../../utils/model/providers.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import {
  modelSupportsThinking,
  providerSupportsThinkingToggle,
  isThinkingMandatory,
  getThinkingOffMode,
} from '../../utils/thinking.js'
import { configuredThinkingBudget, thinkingBudgetSettingsPatch, type ThinkingBudgetSelection } from '../../services/providers/thinkingBudget.js'
import { executeEffort } from '../effort/effort.js'
import type { SettingsJson } from '../../utils/settings/types.js'

export type ThinkingCommandResult = {
  message: string
  thinkingUpdate?: { value: boolean }
  effortUpdate?: { value: EffortValue | undefined }
  providerUpdate?: ProviderSettings
}

export function executeThinkingBudget(args: string, model: string, provider: ProviderId): ThinkingCommandResult {
  const capabilities = getProviderReasoningCapabilitiesForModel(model, provider)
  const settings = getActiveProviderSettings()
  const current = configuredThinkingBudget(provider, model, settings)
  const raw = args.trim().toLowerCase()
  if (!raw || raw === 'status') return { message: `Thinking budget: ${current === undefined ? 'DEFAULT' : current === -1 ? 'AUTO (dynamic)' : current === 0 ? 'OFF' : current + ' tokens'} for ${model} on ${provider}. Use /thinking budget N|auto|default.` }
  const value: ThinkingBudgetSelection = raw === 'default' || (raw === 'auto' && !capabilities?.thinkingBudget?.dynamic) ? 'default' : raw === 'auto' ? -1 : Number(raw)
  try {
    const patch = thinkingBudgetSettingsPatch(provider, model, value, settings, capabilities)
    const result = updateSettingsForSource('localSettings', { provider: patch } as SettingsJson)
    if (result.error) return { message: `Failed to set thinking budget: ${result.error.message}` }
    return { message: `Thinking budget: ${value === 'default' ? 'DEFAULT' : value === -1 ? 'AUTO (dynamic)' : value === 0 ? 'OFF' : value + ' tokens'} for ${model} on ${provider}.${capabilities?.supportedEfforts?.length ? ' The explicit token budget takes precedence over graded effort; use /thinking budget default to return to effort levels.' : ''}`,
      providerUpdate: { thinkingBudgets: getActiveProviderSettings().thinkingBudgets },
      ...(value !== 'default' ? { thinkingUpdate: { value: value !== 0 } } : {}) }
  } catch (error) { return { message: `Not applied: ${error instanceof Error ? error.message : String(error)}` } }
}

function capabilityMessage(
  enabled: boolean,
  model: string,
  provider: ProviderId,
): string {
  if (!modelSupportsThinking(model, provider)) {
    return `${model} on ${provider} does not advertise thinking, so UR will not send a thinking control to it.`
  }
  if (!providerSupportsThinkingToggle(provider, model)) {
    return `${model} advertises thinking, but the ${provider} runtime has no provider-native on/off mapping. ${modelSupportsEffort(model, provider) ? 'Use /effort for its advertised graded control.' : 'UR will not invent a boolean wire field.'}`
  }
  if (!enabled && getThinkingOffMode(model, provider) === 'between_tools') {
    return `${model} skips up-front thinking and can still think between tool calls. Use /effort to choose its reasoning depth.`
  }
  if (!modelSupportsEffort(model, provider)) {
    return `${model} on ${provider} advertises thinking but no model-specific graded ladder. UR uses the provider-native on/off control and sends no graded effort.`
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
  currentEffort?: EffortValue,
): ThinkingCommandResult {
  const normalized = args.trim().toLowerCase()
  if (normalized === 'budget' || normalized.startsWith('budget ')) return executeThinkingBudget(normalized.slice(6), model, provider)
  const capabilities = getProviderReasoningCapabilitiesForModel(model, provider)
  const nativeBudget = configuredThinkingBudget(provider, model, getActiveProviderSettings())
  if (isThinkingMandatory(model, provider) && ['', 'status', 'current', 'on', 'off', 'toggle', 'enable', 'enabled', 'true', 'disable', 'disabled', 'false'].includes(normalized)) {
    return { message: `Thinking: always ON for ${model} on ${provider}. This model cannot disable thinking. ${capabilities?.thinkingBudget ? 'Use /thinking budget N|auto|default to choose its token budget.' : 'Use /effort to choose its reasoning depth.'}` }
  }
  if ((capabilities?.thinkingBudget || nativeBudget !== undefined) && ['', 'status', 'current'].includes(normalized)) {
    const enabled = nativeBudget === undefined ? currentEnabled : nativeBudget !== 0
    const budgetStatus = executeThinkingBudget('status', model, provider).message
    return { message: `Thinking: ${enabled && !isEnvTruthy(process.env.UR_CODE_DISABLE_THINKING) ? 'ON' : 'OFF'}. ${budgetStatus}` }
  }
  const effortLevels = getSupportedEffortLevelsForModel(model, provider)
  if (effortLevels.includes('none')) {
    const displayed = getDisplayedEffortLevel(model, currentEffort, provider)
    const enabled = getProviderEffortWireValue(model, displayed, provider) !== 'none'
    if (['', 'status', 'current'].includes(normalized)) return { message: `Thinking: ${enabled ? 'ON' : 'OFF'} via effort ${displayed} for ${model} on ${provider}. Use /thinking on|off or /effort ${effortLevels.join('|')}.` }
    if (['on', 'off', 'toggle', 'enable', 'enabled', 'true', 'disable', 'disabled', 'false'].includes(normalized)) {
      const wantsOn = normalized === 'toggle' ? !enabled : ['on', 'enable', 'enabled', 'true'].includes(normalized)
      const defaultEffort = getDefaultEffortForModel(model, provider)
      const level = wantsOn ? typeof defaultEffort === 'string' && defaultEffort !== 'none' && getProviderEffortWireValue(model, defaultEffort, provider) !== 'none'
        ? defaultEffort : effortLevels.find(value => getProviderEffortWireValue(model, value, provider) !== 'none') : 'none'
      if (!level) return { message: 'This model does not advertise an enabled reasoning level.' }
      const applied = executeEffort(level, model, provider)
      return { ...applied, message: applied.effortUpdate ? `Thinking ${wantsOn ? 'ON' : 'OFF'} via native effort ${level}. ${applied.message}` : applied.message }
    }
  }
  if (capabilities?.thinkingBudget?.canDisable && ['on', 'off', 'toggle', 'enable', 'enabled', 'true', 'disable', 'disabled', 'false'].includes(normalized)) {
    const enabled = nativeBudget === undefined ? currentEnabled : nativeBudget !== 0
    const wantsOn = normalized === 'toggle' ? !enabled : ['on', 'enable', 'enabled', 'true'].includes(normalized)
    return executeThinkingBudget(wantsOn ? nativeBudget && nativeBudget > 0 ? String(nativeBudget) : 'auto' : '0', model, provider)
  }
  if (!normalized || normalized === 'status' || normalized === 'current') {
    const disabledByEnvironment = isEnvTruthy(
      process.env.UR_CODE_DISABLE_THINKING,
    )
    const statusLabel =
      modelSupportsThinking(model, provider) &&
      providerSupportsThinkingToggle(provider, model)
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

  const clearedBudget = !enabled && nativeBudget !== undefined ? executeThinkingBudget('default', model, provider) : undefined
  if (clearedBudget && !clearedBudget.providerUpdate) return clearedBudget
  const error = persistThinking(enabled)
  if (error) {
    if (clearedBudget && nativeBudget !== undefined) executeThinkingBudget(String(nativeBudget), model, provider)
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
    providerSupportsThinkingToggle(provider, model) &&
    !disabledByEnvironment
  return {
    message: disabledByEnvironment
      ? `Thinking preference saved as ON, but UR_CODE_DISABLE_THINKING disables it for this session. ${capabilityMessage(false, model, provider)}`
      : `${appliesToActiveModel ? 'Thinking' : 'Thinking preference'} ${enabled ? 'ON' : 'OFF'} for this session; user preference saved. ${capabilityMessage(enabled, model, provider)}`,
    thinkingUpdate: { value: enabled },
    ...(clearedBudget?.providerUpdate ? { providerUpdate: clearedBudget.providerUpdate } : {}),
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
  const currentEffort = useAppState(state => state.effortValue)
  const model = useMainLoopModel()
  const provider = getRuntimeProvider()
  const setAppState = useSetAppState()
  const applied = React.useRef(false)

  React.useEffect(() => {
    if (applied.current) return
    applied.current = true
    const result = executeThinking(args, currentEnabled, model, provider, currentEffort)
    if (result.thinkingUpdate || result.effortUpdate || result.providerUpdate) {
      setAppState(previous => ({
        ...previous,
        ...(result.thinkingUpdate ? { thinkingEnabled: result.thinkingUpdate.value } : {}),
        ...(result.effortUpdate ? { effortValue: result.effortUpdate.value } : {}),
        ...(result.providerUpdate ? { provider: { ...previous.provider, ...result.providerUpdate } } : {}),
      }))
    }
    onDone(result.message)
  }, [args, currentEffort, currentEnabled, model, onDone, provider, setAppState])
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
      'Usage: /thinking [on|off|toggle|status|budget N|budget auto|budget default]\n\nUses the active model’s native thinking mode, advertised effort none, or token budget. Mandatory thinking stays enabled. Budgets are saved independently per provider/model; auto requests dynamic thinking where supported and default clears the override. Generic compatible runtimes never receive an invented boolean field. /effort selects advertised named levels.',
    )
    return null
  }
  return <ApplyThinkingAndClose args={args} onDone={onDone} />
}
