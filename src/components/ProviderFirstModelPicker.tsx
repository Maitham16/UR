// @ts-nocheck
import { _c } from 'react/compiler-runtime'
import * as React from 'react'
import { useEffect, useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  listProviders,
  getProviderAccessTypeLabel,
  getProviderStatus,
  type ProviderId,
  type ProviderDefinition,
  type ProviderConnectionStatus,
  type ProviderModelSource,
  listModelsForProviderWithSource,
  setProviderModel,
  validateProviderModelPair,
} from 'src/services/providers/providerRegistry.js'
import { useAppState, useSetAppState } from 'src/state/AppState.js'
import { getSettingsForSource } from 'src/utils/settings/settings.js'
import type { ModelOption } from 'src/utils/model/modelOptions.js'
import { Box, Text } from '../ink.js'
import { useAppState as useAppStateSelector } from '../state/AppState.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  modelSupportsEffort,
} from '../utils/effort.js'
import {
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  shouldEnableThinkingByDefault,
} from '../utils/thinking.js'

const selectCurrentProvider = (s: { provider?: { active?: string } }) =>
  s.provider?.active ?? 'ollama'
const selectEffortValue = (s: { effortValue?: unknown }) => s.effortValue
const selectThinkingEnabled = (s: { thinkingEnabled?: boolean }) => s.thinkingEnabled

type Step = 'provider' | 'model'

type ProviderStatusOption = {
  value: string
  label: string
  description: string
  status: ProviderConnectionStatus
  statusLabel: string
  accessType: string
  credentialType: string
  provider: ProviderDefinition
}

type SelectionMetadata = {
  providerId: ProviderId
  providerName: string
  accessType: string
  modelSource: ProviderModelSource
}

type Props = {
  initial: string | null
  onSelect: (
    model: string | null,
    effort: EffortLevel | undefined,
    metadata?: SelectionMetadata,
  ) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  headerText?: string
}

export function ProviderFirstModelPicker({
  initial,
  onSelect,
  onCancel,
  isStandaloneCommand,
  headerText,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const currentProvider = useAppStateSelector(selectCurrentProvider)
  const [step, setStep] = useState<Step>('provider')
  const [focusedProviderValue, setFocusedProviderValue] = useState<string | null>(null)
  const [focusedModelValue, setFocusedModelValue] = useState<string | null>(null)
  const [providerOptions, setProviderOptions] = useState<ProviderStatusOption[]>([])
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [loadingModels, setLoadingModels] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<ProviderStatusOption | null>(null)
  const [modelSource, setModelSource] = useState<ProviderModelSource>('static')
  const [modelWarning, setModelWarning] = useState<string | null>(null)

  const effortValue = useAppState(selectEffortValue)
  const [effort] = useState<EffortLevel | undefined>(
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  )
  const appThinkingEnabled = useAppState(selectThinkingEnabled)
  const hasToggledThinking = false
  const [thinkingEnabled] = useState(
    () => appThinkingEnabled ?? shouldEnableThinkingByDefault(),
  )

  // Step 1: Load provider status
  useEffect(() => {
    async function loadProviderStatus() {
      setLoadingProviders(true)
      const providers = listProviders()
      const settings = getSettingsForSource('userSettings')

      const options: ProviderStatusOption[] = await Promise.all(
        providers.map(async provider => {
          const status = await getProviderStatus(provider.id, {
            settings: settings ?? undefined,
          })
          const accessType = getProviderAccessTypeLabel(provider)

          return {
            value: provider.id,
            label: provider.displayName,
            description: `${accessType} · ${status.label}`,
            status: status.status,
            statusLabel: status.label,
            accessType,
            credentialType: provider.credentialType,
            provider,
          }
        }),
      )

      setProviderOptions(options)
      setLoadingProviders(false)
    }

    loadProviderStatus()
  }, [])

  // Step 2: Load models for selected provider
  useEffect(() => {
    if (!selectedProvider) return

    async function loadModels() {
      setLoadingModels(true)
      setModelWarning(null)
      const providerId = selectedProvider.value as ProviderId
      const controller = new AbortController()
      const result = await listModelsForProviderWithSource(providerId, {
        settings: getSettingsForSource('userSettings') ?? undefined,
        signal: controller.signal,
      })
      controller.abort()
      const options: ModelOption[] = result.models.map(model => ({
        value: model.id,
        label: model.displayName,
        description: `${model.description} · ${result.source}`,
      }))
      setModelOptions(options)
      setModelSource(result.source)
      setModelWarning(result.warning ?? null)

      setLoadingModels(false)
    }

    loadModels()
  }, [selectedProvider])

  const providerSelectOptions = providerOptions.map(opt => ({
    value: opt.value,
    label: opt.label,
    description: opt.description,
  }))

  const modelSelectOptions = modelOptions.map(opt => ({
    ...opt,
    value: opt.value,
  }))

  const providerVisibleCount = Math.min(10, providerSelectOptions.length)
  const modelVisibleCount = Math.min(10, modelSelectOptions.length)

  const focusedProvider = providerOptions.find(p => p.value === focusedProviderValue)
  const focusedModel = modelOptions.find(m => m.value === focusedModelValue)

  function handleProviderFocus(value: string) {
    setFocusedProviderValue(value)
  }

  function handleModelFocus(value: string) {
    setFocusedModelValue(value)
  }

  function handleProviderSelect(value: string) {
    const provider = providerOptions.find(p => p.value === value)
    if (provider) {
      setSelectedProvider(provider)
      setStep('model')
      setFocusedModelValue(null)
    }
  }

  function handleModelSelect(value: string) {
    logEvent('tengu_model_command_menu_effort', {
      effort: effort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      provider: selectedProvider?.value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      model: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: modelSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    // Validate provider/model compatibility
    if (selectedProvider) {
      const validation = validateProviderModelPair(selectedProvider.value, value, {
        availableModels: modelOptions.map(option => option.value),
      })
      if (validation.valid === false) {
        setModelWarning(validation.error)
        return
      }
    }

    // Update provider and model in settings only after the scoped pair validates.
    if (selectedProvider) {
      const saveResult = setProviderModel(selectedProvider.value, value, {
        availableModels: modelOptions.map(option => option.value),
        modelSource,
      })
      if (!saveResult.ok) {
        setModelWarning(saveResult.message)
        return
      }
    }

    // Update app state
    setAppState(prev => ({
      ...prev,
      provider: {
        ...(prev.provider ?? {}),
        active: selectedProvider?.value,
        model: value,
      },
      effortValue: effort,
      ...(hasToggledThinking ? { thinkingEnabled } : {}),
    }))

    onSelect(value, effort, selectedProvider ? {
      providerId: selectedProvider.value as ProviderId,
      providerName: selectedProvider.label,
      accessType: selectedProvider.accessType,
      modelSource,
    } : undefined)
  }

  function handleBack() {
    setStep('provider')
    setSelectedProvider(null)
    setModelOptions([])
    setModelWarning(null)
  }

  // Provider selection view
  if (step === 'provider') {
    const content = (
      <Box flexDirection="column">
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text color="remember" bold>
              Select provider
            </Text>
            <Text dimColor>
              {headerText ?? 'Choose a model provider. Each provider has its own set of models. After selection, you will choose a model from that provider only.'}
            </Text>
          </Box>

          {loadingProviders ? (
            <Box marginBottom={1}>
              <Text dimColor>Loading provider status...</Text>
            </Box>
          ) : (
            <>
              <Box flexDirection="column" marginBottom={1}>
                <Box flexDirection="column">
                  <Select
                    defaultValue={currentProvider}
                    defaultFocusValue={focusedProviderValue ?? currentProvider}
                    options={providerSelectOptions}
                    onChange={handleProviderSelect}
                    onFocus={handleProviderFocus}
                    onCancel={onCancel ?? noop}
                    visibleOptionCount={providerVisibleCount}
                  />
                </Box>
              </Box>

              {focusedProvider && (
                <Box marginBottom={1} flexDirection="column">
                  <Box marginBottom={1}>
                    <Text bold>{focusedProvider.label}</Text>
                    <Text dimColor> · {focusedProvider.accessType} · {focusedProvider.credentialType}</Text>
                  </Box>
                  <Text dimColor>
                    Status: <Text color={focusedProvider.status === 'connected' ? 'success' : 'error'}>{focusedProvider.status}</Text>
                    <Text dimColor> · {focusedProvider.statusLabel}</Text>
                  </Text>
                  <Text dimColor>
                    {focusedProvider.provider.accessPathLabel}
                  </Text>
                  {focusedProvider.status !== 'connected' && (
                    <Text dimColor color="subtle">
                      Tip: Run `ur provider doctor {focusedProvider.value}` for troubleshooting
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

  // Model selection view
  const content = (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Select model
          </Text>
          <Text dimColor>
            Showing models for {selectedProvider?.label} ({selectedProvider?.accessType})
          </Text>
          <Text dimColor color="subtle">
            Model source: {modelSource}
          </Text>
          <Text dimColor color="subtle">
            Press Esc to change provider
          </Text>
        </Box>

        {loadingModels ? (
          <Box marginBottom={1}>
            <Text dimColor>Loading models...</Text>
          </Box>
        ) : (
          <>
            <Box flexDirection="column" marginBottom={1}>
              <Box flexDirection="column">
                <Select
                  defaultValue={null}
                  defaultFocusValue={focusedModelValue ?? undefined}
                  options={modelSelectOptions}
                  onChange={handleModelSelect}
                  onFocus={handleModelFocus}
                  onCancel={handleBack}
                  visibleOptionCount={modelVisibleCount}
                />
              </Box>
            </Box>

            {focusedModel && (
              <Box marginBottom={1} flexDirection="column">
                <Text dimColor>
                  {focusedModel.label} · {focusedModel.description}
                </Text>
                <Text dimColor color="subtle">
                  Source: {modelSource}
                </Text>
                {modelSupportsEffort(parseUserSpecifiedModel(focusedModel.value)) && (
                  <Text dimColor>
                    ← → to adjust effort
                  </Text>
                )}
              </Box>
            )}

            {modelWarning && (
              <Box marginBottom={1} flexDirection="column">
                <Text dimColor color="error">
                  {modelWarning}
                </Text>
              </Box>
            )}

            {modelOptions.length === 0 && (
              <Box marginBottom={1} flexDirection="column">
                <Text dimColor color="error">
                  No models available for this provider.
                </Text>
                <Text dimColor color="subtle">
                  Run `ur provider doctor {selectedProvider?.value}` to troubleshoot.
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>
      {isStandaloneCommand && (
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <KeyboardShortcutHint shortcut="Esc" action="back" />
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
