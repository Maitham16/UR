// @ts-nocheck
import { _c } from 'react/compiler-runtime'
import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useEffect, useState, useMemo } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  listProviders,
  doctorProvider,
  type ProviderId,
  type ProviderDefinition,
  type ProviderCheck,
  listModelsForProvider,
  validateProviderModelCompatibility,
  getDefaultModelForProvider,
} from 'src/services/providers/providerRegistry.js'
import { useAppState, useSetAppState } from 'src/state/AppState.js'
import { getSettingsForSource, updateSettingsForSource } from 'src/utils/settings/settings.js'
import { getOllamaModelOptions, type ModelOption } from 'src/utils/model/ollamaModels.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { Box, Text } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState as useAppStateSelector } from '../state/AppState.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
} from '../utils/effort.js'
import {
  getDefaultMainLoopModel,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  modelSupportsThinking,
  shouldEnableThinkingByDefault,
} from '../utils/thinking.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

const selectCurrentProvider = (s: { provider?: { active?: string } }) =>
  s.provider?.active ?? 'ollama'
const selectEffortValue = (s: { effortValue?: unknown }) => s.effortValue
const selectFastMode = (s: { fastMode?: boolean }) => false
const selectThinkingEnabled = (s: { thinkingEnabled?: boolean }) => s.thinkingEnabled

type Step = 'provider' | 'model'

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
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void
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
      if (provider.accessType === 'api') {
        const envKey = provider.envKey
        if (envKey) {
          return `${envKey} found`
        }
      }
      if (provider.accessType === 'local' || provider.accessType === 'subscription') {
        return 'connected'
      }
      return 'available'
    case 'missing':
      if (provider.commandCandidates) {
        return `CLI not found (tried: ${provider.commandCandidates.join(', ')})`
      }
      return 'CLI not found'
    case 'unavailable':
      const failCheck = checks.find(c => c.status === 'fail' || c.status === 'warn')
      if (failCheck) {
        return failCheck.message
      }
      return 'not available'
    case 'unknown':
      return 'status unknown'
  }
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
  const [modelSource, setModelSource] = useState<'live' | 'cache' | 'static'>('static')

  const isFastMode = useAppState(selectFastMode)
  const effortValue = useAppState(selectEffortValue)
  const [effort, setEffort] = useState<EffortLevel | undefined>(
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  )
  const appThinkingEnabled = useAppState(selectThinkingEnabled)
  const [hasToggledThinking, setHasToggledThinking] = useState(false)
  const [thinkingEnabled, setThinkingEnabled] = useState(
    () => appThinkingEnabled ?? shouldEnableThinkingByDefault(),
  )

  // Step 1: Load provider status
  useEffect(() => {
    async function loadProviderStatus() {
      setLoadingProviders(true)
      const providers = listProviders()

      const options: ProviderStatusOption[] = await Promise.all(
        providers.map(async provider => {
          const settings = getSettingsForSource('userSettings')
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
      setLoadingProviders(false)
    }

    loadProviderStatus()
  }, [])

  // Step 2: Load models for selected provider
  useEffect(() => {
    if (!selectedProvider) return

    async function loadModels() {
      setLoadingModels(true)
      const providerId = selectedProvider.value as ProviderId
      const isLocalProvider = ['ollama', 'lmstudio', 'llama.cpp', 'vllm'].includes(providerId)

      try {
        if (isLocalProvider) {
          // Dynamic discovery for local providers
          const controller = new AbortController()
          const options = await getOllamaModelOptions(controller.signal)
          setModelOptions(options)
          setModelSource('live')
          controller.abort()
        } else {
          // Static models for API/subscription providers
          const models = listModelsForProvider(providerId)
          if (models.length > 0) {
            const hasDynamic = models.some(m => m.isDynamic)
            if (hasDynamic) {
              // Dynamic provider (e.g., openai-compatible)
              const controller = new AbortController()
              const options = await getOllamaModelOptions(controller.signal)
              setModelOptions(options)
              setModelSource('live')
              controller.abort()
            } else {
              // Static models
              const options: ModelOption[] = models.map(model => ({
                value: model.id,
                label: model.displayName,
                description: model.description,
              }))
              setModelOptions(options)
              setModelSource('static')
            }
          } else {
            setModelOptions([])
            setModelSource('static')
          }
        }
      } catch (error) {
        // Fallback to static models only for this provider
        const models = listModelsForProvider(providerId)
        const options: ModelOption[] = models
          .filter(m => !m.isDynamic)
          .map(model => ({
            value: model.id,
            label: model.displayName,
            description: `${model.description} (cached)`,
          }))
        setModelOptions(options)
        setModelSource('cache')
      }

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
      const validation = validateProviderModelCompatibility(selectedProvider.value, value)
      if (validation.valid === false) {
        // Should not happen since we filter models, but handle it
        return
      }
    }

    // Update provider and model in settings
    if (selectedProvider) {
      updateSettingsForSource('userSettings', {
        provider: {
          active: selectedProvider.value as ProviderId,
          model: value,
        },
      })
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

    // Show confirmation message
    const confirmationParts = [
      `Provider: ${selectedProvider?.label} (${selectedProvider?.accessType})`,
      `Model: ${focusedModel?.label || value}`,
      `Source: ${modelSource}`,
    ]
    if (effort) {
      confirmationParts.push(`Effort: ${capitalize(effort)}`)
    }
    if (thinkingEnabled && focusedModel && modelSupportsThinking(parseUserSpecifiedModel(value))) {
      confirmationParts.push(`Thinking: on`)
    }

    onSelect(value, effort)
  }

  function handleBack() {
    setStep('provider')
    setSelectedProvider(null)
    setModelOptions([])
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
                  </Text>
                  <Text dimColor>
                    {focusedProvider.provider.legalPath}
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

            {modelOptions.length === 0 && (
              <Box marginBottom={1}>
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
