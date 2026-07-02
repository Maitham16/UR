// @ts-nocheck
import * as React from 'react'
import { useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  listProviders,
  getProviderAccessTypeLabel,
  getActiveProviderSettings,
  getProviderRuntimeBlockReason,
  setSafeProviderConfig,
} from 'src/services/providers/providerRegistry.js'
import { useSetAppState } from 'src/state/AppState.js'
import { getSettingsForSource } from 'src/utils/settings/settings.js'
import { Box, Text } from '../ink.js'
import { useAppState as useAppStateSelector } from '../state/AppState.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'

const selectCurrentProvider = (s: { provider?: { active?: string } }) =>
  s.provider?.active ?? 'ollama'

type Props = {
  initial: string | null
  onSelect: (provider: string) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  headerText?: string
}

export function ProviderPicker({
  initial,
  onSelect,
  onCancel,
  isStandaloneCommand,
  headerText,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const currentProvider = useAppStateSelector(selectCurrentProvider)
  const [focusedValue, setFocusedValue] = useState(initial ?? currentProvider)

  const providers = listProviders()
  const selectOptions = providers.map(provider => ({
    value: provider.id,
    label: provider.displayName,
    description: `${getProviderAccessTypeLabel(provider)} · ${provider.credentialType} · ${provider.runtimeKind === 'external-app' ? 'external app bridge' : 'UR-native'}`,
  }))

  const visibleCount = Math.min(10, selectOptions.length)
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount)

  const focusedProvider = providers.find(p => p.id === focusedValue)
  const focusedBlockReason = focusedProvider ? getProviderRuntimeBlockReason(focusedProvider.id) : null

  function handleFocus(value: string) {
    setFocusedValue(value)
  }

  function handleSelect(value: string) {
    logEvent('tengu_provider_command_menu', {
      action: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      from_provider: currentProvider as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_provider: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    const runtimeBlock = getProviderRuntimeBlockReason(value)
    if (runtimeBlock) {
      return
    }

    const result = setSafeProviderConfig('provider', value)
    if (!result.ok) {
      return
    }
    const saved = getActiveProviderSettings(getSettingsForSource('userSettings') ?? {})

    // Update app state
    setAppState(prev => ({
      ...prev,
      provider: {
        ...(prev.provider ?? {}),
        active: saved.active ?? value,
        model: saved.model,
      },
    }))

    onSelect(value)
  }

  const content = (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Select provider
          </Text>
          <Text dimColor>
            {headerText ??
              'Choose a model provider. This will filter the available models to only those from the selected provider.'}
          </Text>
        </Box>
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="column">
            <Select
              defaultValue={currentProvider}
              defaultFocusValue={focusedValue}
              options={selectOptions}
              onChange={handleSelect}
              onFocus={handleFocus}
              onCancel={onCancel ?? noop}
              visibleOptionCount={visibleCount}
            />
          </Box>
          {hiddenCount > 0 && (
            <Box paddingLeft={3}>
              <Text dimColor>and {hiddenCount} more…</Text>
            </Box>
          )}
        </Box>
        <Box marginBottom={1} flexDirection="column">
          {focusedProvider && (
            <Text dimColor>
              {focusedProvider.displayName} ({focusedProvider.id}) ·{' '}
              {getProviderAccessTypeLabel(focusedProvider)} ·{' '}
              {focusedProvider.accessPathLabel}
            </Text>
          )}
          {focusedBlockReason && (
            <Text dimColor color="error">
              {focusedBlockReason}
            </Text>
          )}
        </Box>
      </Box>
      {isStandaloneCommand && (
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint
              action="select:cancel"
              context="Select"
              fallback="Esc"
              description="exit"
            />
          </Byline>
        </Text>
      )}
    </Box>
  )

  if (!isStandaloneCommand) {
    return content
  }
  return <Pane color="permission">{content}</Pane>
}

function noop() {}
