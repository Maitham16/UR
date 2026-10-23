import * as React from 'react'
import { useState } from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Text } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getActiveProviderSettings, setProviderPerformance } from '../../services/providers/providerRegistry.js'
import { getModelPerformanceOptions, getSavedModelPerformanceMode, isAcceleratedPerformanceMode, performanceModeLabel, preferredFastPerformanceMode, type ModelPerformanceMode } from '../../services/providers/modelPerformance.js'
import { getRuntimeProvider } from '../../utils/model/providers.js'
import { isFastModeEnabled } from '../../utils/fastMode.js'

type Context = Pick<LocalJSXCommandContext, 'getAppState' | 'setAppState'>
function applyPerformanceMode(mode: ModelPerformanceMode, context: Context): string {
  const state = context.getAppState()
  const provider = state.provider?.active ?? getRuntimeProvider()
  const model = state.mainLoopModelForSession ?? state.mainLoopModel
  if (!isFastModeEnabled() && isAcceleratedPerformanceMode(mode)) return 'Fast mode is disabled by UR_CODE_DISABLE_FAST_MODE.'
  const saved = setProviderPerformance(provider, model, mode)
  if (!saved.ok) return saved.message
  const effective = getActiveProviderSettings()
  context.setAppState(previous => ({ ...previous, provider: { ...previous.provider, ...effective, active: provider, model }, fastMode: isFastModeEnabled() && isAcceleratedPerformanceMode(mode) }))
  return `Speed: ${performanceModeLabel(mode)} for ${model} on ${provider}.`
}
export function applyNativeFastMode(enabled: boolean, context: Context): string {
  const state = context.getAppState()
  const provider = state.provider?.active ?? getRuntimeProvider()
  const model = state.mainLoopModelForSession ?? state.mainLoopModel
  const mode = enabled ? preferredFastPerformanceMode(provider, model) : 'standard'
  if (!mode) return `No native fast serving tier or routing control is available for ${model} on ${provider}. The selected model was kept.`
  return applyPerformanceMode(mode, context)
}
export function FastModePicker({ onDone }: { onDone: LocalJSXCommandOnDone; unavailableReason?: string | null }): React.ReactNode {
  const model = useMainLoopModel()
  const state = useAppState(value => value)
  const provider = state.provider?.active ?? getRuntimeProvider()
  const setAppState = useSetAppState()
  const options = getModelPerformanceOptions(provider, model).filter(option => isFastModeEnabled() || !isAcceleratedPerformanceMode(option.value))
  const [mode, setMode] = useState(() => {
    const saved = getSavedModelPerformanceMode(provider, model, getActiveProviderSettings())
    return !isFastModeEnabled() && isAcceleratedPerformanceMode(saved) ? 'standard' : saved
  })
  const cycle = (direction: number) => {
    if (!options.length) return
    setMode(previous => options[(options.findIndex(option => option.value === previous) + direction + options.length) % options.length]!.value)
  }
  const confirm = () => {
    if (options.length) onDone(applyPerformanceMode(mode, { getAppState: () => state, setAppState }))
    else onDone('Speed is managed by the provider/runtime.', { display: 'system' })
  }
  useKeybindings({ 'confirm:yes': confirm, 'confirm:nextField': () => cycle(1),
    'confirm:next': () => cycle(1), 'confirm:previous': () => cycle(-1), 'confirm:toggle': () => cycle(1) }, { context: 'Confirmation' })
  return <Dialog title="Model speed" onCancel={() => onDone('Kept model speed.', { display: 'system' })}
    subtitle={options.length ? `${model} · Premium modes cost more; routing preferences do not guarantee latency.` : undefined}>
    <Text>{options.length ? `Speed: ${performanceModeLabel(mode)} · Tab to change · Enter to confirm` : `Speed is managed by ${provider} for this model. No unsupported tier will be sent.`}</Text>
  </Dialog>
}
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args = ''): Promise<React.ReactNode | null> {
  const action = args.trim().toLowerCase()
  if (action === 'on' || action === 'off') { onDone(applyNativeFastMode(action === 'on', context)); return null }
  const state = context.getAppState()
  const provider = state.provider?.active ?? getRuntimeProvider()
  const model = state.mainLoopModelForSession ?? state.mainLoopModel
  const options = getModelPerformanceOptions(provider, model)
  if (action === 'status') {
    const settings = getActiveProviderSettings()
    const saved = getSavedModelPerformanceMode(provider, model, settings)
    const mode = !isFastModeEnabled() && isAcceleratedPerformanceMode(saved) ? 'standard' : saved
    const upstream = provider === 'openrouter' && ((settings.openrouter?.serviceTier && settings.openrouter.serviceTier !== 'auto') || settings.openrouter?.speed === 'fast')
      ? ` Configured upstream tier: ${settings.openrouter?.serviceTier ?? 'auto'}; upstream speed: ${settings.openrouter?.speed ?? 'standard'}.` : ''
    onDone(options.length ? `Speed: ${performanceModeLabel(mode)} for ${model} on ${provider}.${upstream}${!isFastModeEnabled() ? ' Accelerated modes are disabled by UR_CODE_DISABLE_FAST_MODE.' : ''}` : `Speed is managed by ${provider}; no native serving-tier control is advertised for ${model}.`)
    return null
  }
  if (options.some(option => option.value === action)) { onDone(applyPerformanceMode(action as ModelPerformanceMode, context)); return null }
  if (action) { onDone(`Usage: /fast [on|off|status${options.length ? '|' + options.map(option => option.value).join('|') : ''}]`); return null }
  return <FastModePicker onDone={onDone} />
}
