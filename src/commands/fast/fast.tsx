import * as React from 'react'
import { useState } from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Text } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getAnthropicFastMode } from '../../services/providers/anthropicCapabilities.js'
import { getActiveProviderSettings, setSafeProviderConfig } from '../../services/providers/providerRegistry.js'
import { getRuntimeProvider } from '../../utils/model/providers.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { isFastModeEnabled } from '../../utils/fastMode.js'

export function applyNativeFastMode(enabled: boolean, context: Pick<LocalJSXCommandContext, 'getAppState' | 'setAppState'>): string {
  const state = context.getAppState()
  const provider = state.provider?.active ?? getRuntimeProvider()
  const model = state.mainLoopModelForSession ?? state.mainLoopModel
  if (!isFastModeEnabled()) return 'Fast mode is disabled by UR_CODE_DISABLE_FAST_MODE.'
  if (provider !== 'anthropic-api') return `No native fast serving tier is configured for ${provider}.`
  if (enabled && !getAnthropicFastMode(model)) return `Fast mode is not supported for ${model}. The selected model was kept.`
  const saved = setSafeProviderConfig('anthropic.speed', enabled ? 'fast' : 'standard')
  if (!saved.ok) return saved.message
  const effective = getActiveProviderSettings(getInitialSettings())
  context.setAppState(previous => ({ ...previous,
    provider: { ...previous.provider, anthropic: effective.anthropic },
    fastMode: effective.anthropic?.speed === 'fast',
  }))
  return `Speed: ${effective.anthropic?.speed === 'fast' ? 'FAST (premium provider pricing)' : 'STANDARD'} for ${model}.`
}

export function FastModePicker({ onDone }: { onDone: LocalJSXCommandOnDone; unavailableReason?: string | null }): React.ReactNode {
  const model = useMainLoopModel()
  const provider = useAppState(state => state.provider?.active ?? getRuntimeProvider())
  const setAppState = useSetAppState()
  const state = useAppState(state => state)
  const [fast, setFast] = useState(() => getActiveProviderSettings(getInitialSettings()).anthropic?.speed === 'fast')
  const supported = isFastModeEnabled() && provider === 'anthropic-api' && Boolean(getAnthropicFastMode(model))
  const confirm = () => {
    if (supported) onDone(applyNativeFastMode(fast, { getAppState: () => state, setAppState }))
  }
  useKeybindings({ 'confirm:yes': confirm, 'confirm:nextField': () => setFast(value => !value),
    'confirm:next': () => setFast(value => !value), 'confirm:previous': () => setFast(value => !value),
    'confirm:toggle': () => setFast(value => !value) }, { context: 'Confirmation' })
  return <Dialog title="Model speed" onCancel={() => onDone('Kept model speed.', { display: 'system' })}
    subtitle={supported ? `${model} · Fast uses premium provider pricing and separate rate limits.` : undefined}>
    <Text>{supported ? `Speed: ${fast ? 'FAST' : 'STANDARD'} · Tab to change · Enter to confirm` : `No native fast serving tier is available for ${model} on ${provider}.`}</Text>
  </Dialog>
}

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args = ''): Promise<React.ReactNode | null> {
  const action = args.trim().toLowerCase()
  if (action === 'on' || action === 'off') {
    onDone(applyNativeFastMode(action === 'on', context)); return null
  }
  if (action === 'status') {
    const state = context.getAppState()
    const provider = state.provider?.active ?? getRuntimeProvider()
    const model = state.mainLoopModelForSession ?? state.mainLoopModel
    const supported = provider === 'anthropic-api' && Boolean(getAnthropicFastMode(model))
    const speed = getActiveProviderSettings(getInitialSettings()).anthropic?.speed ?? 'standard'
    if (!isFastModeEnabled()) { onDone('Speed: STANDARD. Fast mode is disabled by UR_CODE_DISABLE_FAST_MODE.'); return null }
    onDone(supported ? `Speed: ${speed.toUpperCase()} for ${model}.${speed === 'fast' ? ' Premium provider pricing applies.' : ''}` : `No native fast serving tier is available for ${model} on ${provider}.`)
    return null
  }
  if (action) { onDone('Usage: /fast [on|off|status]'); return null }
  return <FastModePicker onDone={onDone} />
}
