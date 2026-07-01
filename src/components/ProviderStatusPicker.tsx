// @ts-nocheck
import { _c } from 'react/compiler-runtime'
import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useEffect, useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  listProviders,
  doctorActiveProvider,
  doctorProvider,
  type ProviderId,
  type ProviderDefinition,
  type ProviderCheck,
  getProviderRuntimeInfo,
} from 'src/services/providers/providerRegistry.js'
import { useAppState, useSetAppState } from 'src/state/AppState.js'
import { getSettingsForSource } from 'src/utils/settings/settings.js'
import { Box, Text } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState as useAppStateSelector } from '../state/AppState.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'

const selectCurrentProvider = (s: { provider?: { active?: string } }) =>
  s.provider?.active ?? 'ollama'

type ProviderStatusOption = {
  value: string
  label: string
  description: string
  status: 'connected' | 'missing' | 'unavailable' | 'unknown'
  accessType: string
  credentialType: string
  provider: ProviderDefinition
}

type Props = {
  initial: string | null
  onSelect: (provider: string) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  headerText?: string
}

function getStatusFromDoctorResult(
  doctorResult: Awaited<ReturnType<typeof doctorProvider>>,
): 'connected' | 'missing' | 'unavailable' | 'unknown' {
  if (doctorResult.ok) {
    return 'connected'
  }
  if (doctorResult.failureReason?.includes('CLI missing') || doctorResult.failureReason?.includes('not found')) {
    return 'missing'
  }
  if (doctorResult.failureReason?.includes('not logged in') || doctorResult.failureReason?.includes('not authenticated')) {
    return 'unavailable'
  }
  if (doctorResult.failureReason?.includes('API key missing') || doctorResult.failureReason?.includes('endpoint')) {
    return 'unavailable'
  }
  return 'unknown'
}

function getCredentialType(provider: ProviderDefinition): string {
  switch (provider.authMode) {
    case 'subscription':
      return 'cli-login'
    case 'enterprise-login':
    case 'personal-login':
      return 'cli-login'
    case 'api':
      return 'api-key'
    case 'local':
      return provider.endpointKind ? 'openai-compatible-endpoint' : 'local-runtime'
    default:
      return 'unknown'
  }
}

function formatStatusMessage(
  status: 'connected' | 'missing' | 'unavailable' | 'unknown',
  provider: ProviderDefinition,
  checks: ProviderCheck[],
): string {
  switch (status) {
    case 'connected':
      return 'connected'
    case 'missing':
      if (provider.commandCandidates) {
        return `CLI not found (tried: ${provider.commandCandidates.join(', ')})`
      }
      return 'CLI not found'
    case 'unavailable':
      // Find the most relevant failure message
      const failCheck = checks.find(c => c.status === 'fail' || c.status === 'warn')
      if (failCheck) {
        return failCheck.message
      }
      return 'not available'
    case 'unknown':
      return 'status unknown'
  }
}

export function ProviderStatusPicker({
  initial,
  onSelect,
  onCancel,
  isStandaloneCommand,
  headerText,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const currentProvider = useAppStateSelector(selectCurrentProvider)
  const [focusedValue, setFocusedValue] = useState(initial ?? currentProvider)
  const [providerOptions, setProviderOptions] = useState<ProviderStatusOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadProviderStatus() {
      setLoading(true)
      const providers = listProviders()
      const settings = getSettingsForSource('userSettings')

      const options: ProviderStatusOption[] = await Promise.all(
        providers.map(async provider => {
          const doctorResult = await doctorProvider(provider.id, { settings })
          const status = getStatusFromDoctorResult(doctorResult)
          const credentialType = getCredentialType(provider)

          return {
            value: provider.id,
            label: provider.displayName,
            description: `${capitalize(provider.accessType)} · ${formatStatusMessage(status, provider, doctorResult.checks)}`,
            status,
            accessType: provider.accessType,
            credentialType,
            provider,
          }
        }),
      )

      setProviderOptions(options)
      setLoading(false)
    }

    loadProviderStatus()
  }, [])

  const selectOptions = providerOptions.map(opt => ({
    value: opt.value,
    label: opt.label,
    description: opt.description,
  }))

  const visibleCount = Math.min(10, selectOptions.length)
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount)

  const focusedOption = providerOptions.find(p => p.value === focusedValue)

  function handleFocus(value: string) {
    setFocusedValue(value)
  }

  function handleSelect(value: string) {
    logEvent('tengu_provider_status_menu', {
      action: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      from_provider: currentProvider as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_provider: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

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
              'Choose a model provider. Each provider has its own set of models. After selection, you will choose a model from that provider only.'}
          </Text>
        </Box>

        {loading ? (
          <Box marginBottom={1}>
            <Text dimColor>Loading provider status...</Text>
          </Box>
        ) : (
          <>
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

            {focusedOption && (
              <Box marginBottom={1} flexDirection="column">
                <Box marginBottom={1}>
                  <Text bold>{focusedOption.label}</Text>
                  <Text dimColor> · {focusedOption.accessType} · {focusedOption.credentialType}</Text>
                </Box>
                <Text dimColor>
                  Status: <Text color={focusedOption.status === 'connected' ? 'success' : 'error'}>{focusedOption.status}</Text>
                </Text>
                <Text dimColor>
                  {focusedOption.provider.legalPath}
                </Text>
                {focusedOption.status !== 'connected' && (
                  <Text dimColor color="subtle">
                    Tip: Run `ur provider doctor {focusedOption.value}` for troubleshooting
                  </Text>
                )}
              </Box>
            )}
          </>
        )}
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
