// @ts-nocheck
import { _c } from 'react/compiler-runtime'
import * as React from 'react'
import { useContext, useEffect, useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  clearProviderModelCache,
  getActiveProviderSettings,
  getScopedProviderBaseUrl,
  listProviders,
  getProviderAccessTypeLabel,
  type ProviderId,
  type ProviderDefinition,
  type ProviderConnectionStatus,
  type ProviderModelDefinition,
  type ProviderModelSource,
  listModelsForProviderWithSource,
  setSafeProviderConfig,
  setProviderModel,
  validateProviderModelPair,
  getProviderRuntimeBlockReason,
  authAliasForProvider,
  ensureProviderModelsFresh,
  ensureProviderReasoningCapabilitiesForModel,
} from 'src/services/providers/providerRegistry.js'
import {
  clearProviderApiKey,
  type ApiKeySource,
  getProviderApiKeySource,
  setProviderApiKey,
} from 'src/services/providers/providerCredentials.js'
import {
  describeApiKeyProblem,
  sanitizeApiKeyInput,
} from 'src/services/providers/apiKeyInput.js'
import { TerminalSizeContext } from '../ink/components/TerminalSizeContext.js'
import { useAppState, useSetAppState } from 'src/state/AppState.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from 'src/utils/settings/settings.js'
import {
  executePostModelSwitchHooks,
  executePreModelSwitchHooks,
  hasBlockingResult,
} from 'src/utils/hooks.js'
import type { ModelOption } from 'src/utils/model/modelOptions.js'
import { Box, Text, useInput } from '../ink.js'
import { useAppState as useAppStateSelector } from '../state/AppState.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import TextInput from './TextInput.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  getSupportedEffortLevelLabelsForModel,
  getSupportedEffortLevelsForModel,
  modelSupportsEffort,
  resolveProviderEffortLevel,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  modelSupportsThinking,
  providerSupportsThinkingToggle,
  resolveThinkingArrowValue,
  shouldEnableThinkingByDefault,
} from '../utils/thinking.js'
import { resolveActiveProviderModel } from '../services/api/providerClient.js'
import { effortLevelToSymbol } from './EffortIndicator.js'
import {
  buildProviderModelLabels,
  fullProviderModelDisplayName,
} from '../utils/model/modelPresentation.js'

const selectCurrentProvider = (s: { provider?: { active?: string } }) =>
  s.provider?.active ?? 'ollama'
const selectEffortValue = (s: { effortValue?: unknown }) => s.effortValue
const selectThinkingEnabled = (s: { thinkingEnabled?: boolean }) => s.thinkingEnabled

type Step = 'provider' | 'connect' | 'manage' | 'model'
type ConnectionMode = 'api-key' | 'endpoint'

type ProviderStatusOption = {
  value: string
  label: string
  description: string
  status: ProviderConnectionStatus
  statusLabel: string
  accessType: string
  credentialType: string
  runtimeBlockedReason: string | null
  provider: ProviderDefinition
}

type SelectionMetadata = {
  providerId: ProviderId
  providerName: string
  accessType: string
  modelSource: ProviderModelSource
  runtimeBackend: string
}

export type NvidiaTaskSelectionMetadata = {
  modelId: string
  displayName: string
  taskKind: import('../services/providers/nvidiaHostedModels.js').NvidiaHostedTaskKind
  purpose: string
}

export function shouldIncludeProviderModelInPicker(
  model: Pick<ProviderModelDefinition, 'usageMode'>,
  allowsTaskSelection: boolean,
): boolean {
  return model.usageMode !== 'task' || allowsTaskSelection
}

type Props = {
  initial: string | null
  onSelect: (
    model: string | null,
    effort: EffortLevel | undefined,
    metadata?: SelectionMetadata,
  ) => void
  onCancel?: () => void
  onTaskSelect?: (selection: NvidiaTaskSelectionMetadata) => void
  /** First-run setup still needs an agent model after choosing a task runtime. */
  continueAfterTaskSelect?: boolean
  isStandaloneCommand?: boolean
  headerText?: string
}

export function ProviderFirstModelPicker({
  initial,
  onSelect,
  onCancel,
  onTaskSelect,
  continueAfterTaskSelect = false,
  isStandaloneCommand,
  headerText,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const currentProvider = useAppStateSelector(selectCurrentProvider)
  const [step, setStep] = useState<Step>('provider')
  const [focusedProviderValue, setFocusedProviderValue] = useState<string | null>(null)
  const [focusedModelValue, setFocusedModelValue] = useState<string | null>(null)
  const [providerOptions, setProviderOptions] = useState<ProviderStatusOption[]>([])
  const [modelOptions, setModelOptions] = useState<Array<ModelOption & { disabled?: boolean }>>([])
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [loadingModels, setLoadingModels] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<ProviderStatusOption | null>(null)
  const [modelSource, setModelSource] = useState<ProviderModelSource>('static')
  const [modelWarning, setModelWarning] = useState<string | null>(null)
  const [providerWarning, setProviderWarning] = useState<string | null>(null)
  const [connectingProvider, setConnectingProvider] = useState<ProviderStatusOption | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiKeyCursorOffset, setApiKeyCursorOffset] = useState(0)
  const [endpointInput, setEndpointInput] = useState('')
  const [endpointCursorOffset, setEndpointCursorOffset] = useState(0)
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('api-key')
  const [connectReturnStep, setConnectReturnStep] = useState<Step>('provider')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [credentialNotice, setCredentialNotice] = useState<string | null>(null)
  const [effortCapabilityLoading, setEffortCapabilityLoading] = useState(false)
  const [effortCapabilityWarning, setEffortCapabilityWarning] = useState<string | null>(null)
  // Bumping this re-runs discovery for the selected provider (the retry state).
  const [modelReloadToken, setModelReloadToken] = useState(0)
  const handledModelReloadToken = React.useRef(modelReloadToken)
  const terminalSize = useContext(TerminalSizeContext)
  // Keep the label and masked secret on one stable row. The old 20-column
  // minimum could exceed a narrow pane and render one character per line.
  const keyInputColumns = getProviderKeyInputColumns(terminalSize?.columns)

  const effortValue = useAppState(selectEffortValue)
  const [effort, setEffort] = useState<EffortLevel | undefined>(
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  )
  const [hasToggledEffort, setHasToggledEffort] = useState(false)
  const appThinkingEnabled = useAppState(selectThinkingEnabled)
  const [hasToggledThinking, setHasToggledThinking] = useState(false)
  const [thinkingEnabled, setThinkingEnabled] = useState(
    () => appThinkingEnabled ?? shouldEnableThinkingByDefault(),
  )

  // Step 1: Load provider status
  useEffect(() => {
    function loadProviderStatus() {
      setLoadingProviders(true)
      const providers = listProviders({ includeExternalAppBridges: true }).filter(
        provider => provider.id !== 'nvidia-special' || onTaskSelect !== undefined,
      )
      const settings = getInitialSettings()

      // Keep opening /model instantaneous. Endpoint verification and the live
      // model fetch are one operation after selection; probing every provider
      // here doubled OpenRouter's large /models request and made one slow
      // gateway block the entire provider list.
      const options: ProviderStatusOption[] = providers.map(provider => {
        const status = providerPickerStatusWithoutNetwork(provider, settings)
        const accessType = getProviderAccessTypeLabel(provider)

        return {
          value: provider.id,
          label: provider.displayName,
          description: `${accessType} · ${provider.credentialType} · ${provider.runtimeKind === 'external-app' ? 'external app bridge' : status.label}`,
          status: status.status,
          statusLabel: status.label,
          accessType,
          credentialType: provider.credentialType,
          runtimeBlockedReason: getProviderRuntimeBlockReason(provider.id),
          provider,
        }
      })

      setProviderOptions(options)
      setLoadingProviders(false)
    }

    loadProviderStatus()
  }, [onTaskSelect])

  // Step 2: Load models for selected provider
  useEffect(() => {
    if (!selectedProvider) return

    // Aborting the controller immediately after awaiting cancelled nothing and
    // left no way to drop a response for a provider the user had moved away
    // from. The controller now lives for the effect and is aborted on cleanup.
    const controller = new AbortController()
    let cancelled = false

    async function loadModels() {
      setLoadingModels(true)
      setModelWarning(null)
      const providerId = selectedProvider.value as ProviderId
      const forceRefresh =
        modelReloadToken !== handledModelReloadToken.current
      handledModelReloadToken.current = modelReloadToken
      try {
        const discoveryOptions = {
          settings: getInitialSettings(),
          signal: controller.signal,
        }
        // OpenRouter's catalogue is large. Reopening the provider reuses the
        // endpoint-scoped five-minute cache; Ctrl+R still forces a live fetch.
        const result =
          providerId === 'openrouter' && !forceRefresh
            ? await ensureProviderModelsFresh(providerId, discoveryOptions)
            : await listModelsForProviderWithSource(providerId, {
                ...discoveryOptions,
                freshOnly: providerId === 'openrouter' && forceRefresh,
              })
        if (cancelled) return
        const modelLabels = buildProviderModelLabels(providerId, result.models)
        const options: Array<ModelOption & { disabled?: boolean }> = result.models
          .filter(model =>
            shouldIncludeProviderModelInPicker(
              model,
              onTaskSelect !== undefined,
            ),
          )
          .map(model => ({
            value: model.id,
            label: modelLabels.get(model.id) ?? model.displayName,
            description: formatProviderModelDescription(
              model,
              result.source,
              providerId,
            ),
            pricing: model.pricing,
            contextLength: model.contextLength,
            supportedParameters: model.supportedParameters,
            reasoning: model.reasoning,
            usageMode: model.usageMode,
            taskKind: model.taskKind,
            purpose: model.purpose,
            ...(model.usageMode !== 'task' &&
            model.supportedParameters !== undefined &&
            !model.supportedParameters.includes('tools')
              ? { disabled: true }
              : {}),
          }))
        setModelOptions(options)
        setModelSource(result.source)
        setModelWarning(result.warning ?? null)
      } catch (error) {
        if (cancelled) return
        // Discovery already degrades to cache/static internally, so reaching
        // here means the call itself failed. Report it rather than rendering
        // an empty list that looks like "this provider has no models".
        setModelOptions([])
        setModelSource('unavailable')
        setModelWarning(
          `Could not load models: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        if (!cancelled) setLoadingModels(false)
      }
    }

    loadModels()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedProvider, modelReloadToken, onTaskSelect])

  // llama.cpp, Ollama, and vLLM publish decisive reasoning capabilities outside their
  // ordinary model-list rows. Resolve only the focused model so arrow browsing
  // stays truthful without eagerly probing a whole local or cloud catalogue.
  useEffect(() => {
    const capabilityProvider = selectedProvider?.value
    if (
      (capabilityProvider !== 'llama.cpp' &&
        capabilityProvider !== 'ollama' &&
        capabilityProvider !== 'vllm') ||
      !focusedModelValue
    ) {
      setEffortCapabilityLoading(false)
      setEffortCapabilityWarning(null)
      return
    }
    const focused = modelOptions.find(model => model.value === focusedModelValue)
    if (!focused || focused.reasoning !== undefined) {
      setEffortCapabilityLoading(false)
      setEffortCapabilityWarning(null)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    const timer = setTimeout(() => {
      setEffortCapabilityLoading(true)
      setEffortCapabilityWarning(null)
      void ensureProviderReasoningCapabilitiesForModel(
        capabilityProvider,
        focusedModelValue,
        {
          settings: getInitialSettings(),
          signal: controller.signal,
        },
      )
        .then(reasoning => {
          if (cancelled) return
          setModelOptions(previous =>
            previous.map(model =>
              model.value === focusedModelValue
                ? { ...model, reasoning: reasoning ?? { supportedEfforts: [] } }
                : model,
            ),
          )
        })
        .catch(error => {
          if (cancelled || controller.signal.aborted) return
          setEffortCapabilityWarning(
            `Could not verify effort levels: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
        .finally(() => {
          if (!cancelled) setEffortCapabilityLoading(false)
        })
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [selectedProvider?.value, focusedModelValue, modelOptions])

  // The key-entry view advertises Esc but the text input owns the key, so the
  // step needs its own listener to actually go back.
  useInput(
    (_input, key) => {
      if (key.escape) {
        handleKeyCancel()
      }
    },
    { isActive: step === 'connect' },
  )

  // Endpoint editing stays available even when the initial provider list uses
  // its fast, non-network status. This also makes switching among several
  // saved local/server addresses a one-screen workflow.
  useInput(
    (input, _key, event) => {
      if (input.toLowerCase() !== 'e' || !selectedProvider) return
      if (!providerSupportsEndpointEditing(selectedProvider.provider)) return
      const settings = getInitialSettings()
      setConnectingProvider(selectedProvider)
      setConnectionMode('endpoint')
      setConnectReturnStep('model')
      setEndpointInput(
        getScopedProviderBaseUrl(
          selectedProvider.value as ProviderId,
          settings,
        ) ?? selectedProvider.provider.defaultBaseUrl ?? '',
      )
      setEndpointCursorOffset(0)
      setConnectError(null)
      setStep('connect')
      event.stopImmediatePropagation()
    },
    { isActive: step === 'model' && !loadingModels },
  )

  // Generic OpenAI-compatible endpoints may be anonymous locally and require
  // authentication remotely. Keep optional key entry available without
  // changing the provider into a key-required provider.
  useInput(
    (input, _key, event) => {
      if (input.toLowerCase() !== 'k' || !selectedProvider) return
      if (!providerSupportsApiKeyEditing(selectedProvider.provider)) return
      setConnectingProvider(selectedProvider)
      setApiKeyInput('')
      setApiKeyCursorOffset(0)
      setConnectionMode('api-key')
      setConnectReturnStep('model')
      setConnectError(null)
      setStep('connect')
      event.stopImmediatePropagation()
    },
    { isActive: step === 'model' && !loadingModels },
  )

  // Ctrl+R re-runs discovery so a transient network failure or a provider that
  // has just published a model does not require leaving and reopening /model.
  useInput(
    (input, key) => {
      if (key.ctrl && (input === 'r' || input === 'R')) {
        setModelReloadToken(token => token + 1)
      }
    },
    { isActive: step === 'model' && !loadingModels },
  )

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
  // Model catalogues run to hundreds of entries on OpenRouter, so the window
  // is sized to the terminal instead of a fixed 10.
  const modelVisibleCount = Math.max(
    1,
    Math.min(modelSelectOptions.length, Math.max(5, (terminalSize?.rows ?? 24) - 14)),
  )

  const focusedProvider = providerOptions.find(p => p.value === focusedProviderValue)
  const focusedModel = modelOptions.find(m => m.value === focusedModelValue)
  const focusedResolvedModel = focusedModel
    ? parseUserSpecifiedModel(focusedModel.value)
    : undefined
  const focusedProviderId = selectedProvider?.value as ProviderId | undefined
  const focusedIsTaskModel = focusedModel?.usageMode === 'task'
  const focusedEffortLevels =
    focusedResolvedModel && focusedProviderId && !focusedIsTaskModel
      ? getSupportedEffortLevelsForModel(
          focusedResolvedModel,
          focusedProviderId,
        )
      : []
  const focusedEffortLevelLabels =
    focusedResolvedModel && focusedProviderId && !focusedIsTaskModel
      ? getSupportedEffortLevelLabelsForModel(
          focusedResolvedModel,
          focusedProviderId,
        )
      : []
  const focusedSupportsEffort = focusedResolvedModel && !focusedIsTaskModel
    ? modelSupportsEffort(focusedResolvedModel, focusedProviderId)
    : false
  const focusedAdvertisesThinking = focusedResolvedModel && focusedProviderId && !focusedIsTaskModel
    ? modelSupportsThinking(focusedResolvedModel, focusedProviderId)
    : false
  const focusedSupportsThinking = focusedResolvedModel && focusedProviderId
    ? focusedAdvertisesThinking &&
      providerSupportsThinkingToggle(focusedProviderId, focusedResolvedModel)
    : false
  const focusedDefaultEffort = focusedResolvedModel
    ? convertEffortValueToLevel(
        getDefaultEffortForModel(focusedResolvedModel, focusedProviderId) ??
          (focusedEffortLevels.includes('high')
            ? 'high'
            : focusedEffortLevels.at(-1)) ??
          'high',
      )
    : 'high'
  const displayedEffort = focusedResolvedModel
    ? resolveProviderEffortLevel(
        focusedResolvedModel,
        effort ?? focusedDefaultEffort,
        focusedProviderId,
      ) ?? focusedDefaultEffort
    : focusedDefaultEffort

  function handleProviderFocus(value: string) {
    setFocusedProviderValue(value)
    setProviderWarning(null)
    setCredentialNotice(null)
  }

  function handleModelFocus(value: string) {
    setFocusedModelValue(value)
  }

  function handleCycleEffort(direction: 'left' | 'right') {
    if (!focusedSupportsEffort) {
      if (focusedSupportsThinking) {
        setThinkingEnabled(resolveThinkingArrowValue(direction))
        setHasToggledThinking(true)
      }
      return
    }
    setEffort(previous =>
      cycleProviderPickerEffort(
        resolveProviderEffortLevel(
          focusedResolvedModel!,
          previous ?? focusedDefaultEffort,
          focusedProviderId,
        ) ?? focusedDefaultEffort,
        direction,
        focusedEffortLevels,
      ),
    )
    setHasToggledEffort(true)
  }

  useInput(
    (_input, key, event) => {
      if (!key.leftArrow && !key.rightArrow) return
      handleCycleEffort(key.rightArrow ? 'right' : 'left')
      event.stopImmediatePropagation()
    },
    {
      isActive:
        step === 'model' &&
        !loadingModels &&
        (focusedSupportsEffort || focusedSupportsThinking),
    },
  )

  useInput(
    (input, _key, event) => {
      if (input.toLowerCase() !== 't' || !focusedSupportsThinking) return
      setThinkingEnabled(previous => !previous)
      setHasToggledThinking(true)
      event.stopImmediatePropagation()
    },
    {
      isActive:
        step === 'model' && !loadingModels && focusedSupportsThinking,
    },
  )

  function handleProviderSelect(value: string) {
    const provider = providerOptions.find(p => p.value === value)
    if (provider) {
      if (provider.runtimeBlockedReason) {
        setProviderWarning(provider.runtimeBlockedReason)
        return
      }
      if (
        getProviderApiKeySource(provider.value) === 'stored' &&
        (provider.credentialType === 'api-key' || provider.provider.requiresApiKey)
      ) {
        // A key UR itself stores can be replaced or removed from here. An
        // env-var key belongs to the shell, so there is nothing to manage.
        setConnectingProvider(provider)
        setCredentialNotice(null)
        setConnectError(null)
        setStep('manage')
        return
      }
      if (provider.status !== 'connected') {
        if (
          (provider.credentialType === 'api-key' ||
            provider.provider.requiresApiKey) &&
          getProviderApiKeySource(provider.value) === 'none'
        ) {
          // Add the API key right here, while UR is running, then load models.
          setConnectingProvider(provider)
          setApiKeyInput('')
          setApiKeyCursorOffset(0)
          setConnectionMode('api-key')
          setConnectReturnStep('provider')
          setConnectError(null)
          setStep('connect')
          return
        }
        if (
          provider.status === 'missing' &&
          (provider.credentialType === 'openai-compatible-endpoint' ||
            provider.credentialType === 'local-runtime')
        ) {
          // Local/server providers are configured in-place. Requiring users
          // to leave /model, switch the global provider, and then set a URL
          // made the provider-first flow a dead end.
          const settings = getInitialSettings()
          setConnectingProvider(provider)
          setConnectionMode('endpoint')
          setConnectReturnStep('provider')
          setEndpointInput(
            getScopedProviderBaseUrl(provider.value as ProviderId, settings) ??
              provider.provider.defaultBaseUrl ??
              '',
          )
          setEndpointCursorOffset(0)
          setConnectError(null)
          setStep('connect')
          return
        }
        if (provider.provider.accessType === 'subscription') {
          setProviderWarning(`${provider.label} is not logged in. Sign in with \`ur auth ${authAliasForProvider(provider.value)}\` (uses your own subscription), then reselect.`)
          return
        }
        if (provider.status !== 'unknown') {
          setProviderWarning(`Provider "${provider.value}" is ${provider.status}: ${provider.statusLabel}. Run \`ur provider doctor ${provider.value}\`, or choose a connected API/local/server provider.`)
          return
        }
      }
      setSelectedProvider(provider)
      setStep('model')
      setFocusedModelValue(null)
    }
  }

  async function handleModelSelect(value: string) {
    const selectedOption = modelOptions.find(model => model.value === value)
    if (
      selectedOption?.usageMode === 'task' &&
      selectedOption.taskKind &&
      selectedOption.purpose
    ) {
      setAppState(previous => ({
        ...previous,
        nvidiaTaskModel: value,
      }))
      onTaskSelect?.({
        modelId: value,
        displayName: selectedOption.label,
        taskKind: selectedOption.taskKind,
        purpose: selectedOption.purpose,
      })
      if (continueAfterTaskSelect) {
        setSelectedProvider(null)
        setModelOptions([])
        setFocusedModelValue(null)
        setProviderWarning(
          'NVIDIA Special task mode is ready. Now choose the provider and model UR should use for ordinary agent conversations.',
        )
        setStep('provider')
      }
      return
    }
    const selectedProviderId = selectedProvider?.value as ProviderId | undefined
    const selectedResolvedModel = parseUserSpecifiedModel(value)
    const selectedEffort =
      hasToggledEffort && selectedProviderId && effort
        ? resolveProviderEffortLevel(
            selectedResolvedModel,
            effort,
            selectedProviderId,
          )
        : undefined
    logEvent('tengu_model_command_menu_effort', {
      effort: selectedEffort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
    let runtimeBackend: string | undefined
    let savedProviderSettings
    if (selectedProvider) {
      const previous = getActiveProviderSettings(getInitialSettings())
      const hookDetails = {
        fromProvider: previous.active,
        fromModel: previous.model,
        toProvider: selectedProvider.value,
        toModel: value,
        source: 'picker' as const,
      }
      const isSwitch =
        previous.active !== selectedProvider.value || previous.model !== value

      try {
        const runtime = resolveActiveProviderModel({
          settings: {
            provider: {
              active: selectedProvider.value as ProviderId,
              model: value,
            },
            model: value,
          },
          model: value,
          source: '/model',
        })
        runtimeBackend = runtime.runtimeBackend
      } catch (error) {
        setModelWarning(error instanceof Error ? error.message : String(error))
        return
      }

      if (isSwitch) {
        const preResults = await executePreModelSwitchHooks(hookDetails)
        if (hasBlockingResult(preResults)) {
          const reason = preResults
            .filter(result => result.blocked)
            .map(result => result.output.trim())
            .filter(Boolean)
            .join('\n')
          setModelWarning(
            `Model switch blocked by PreModelSwitch hook${reason ? `: ${reason}` : '.'}`,
          )
          return
        }
      }

      const saveResult = setProviderModel(selectedProvider.value, value, {
        availableModels: modelOptions.map(option => option.value),
        modelSource,
      })
      if (!saveResult.ok) {
        setModelWarning(saveResult.message)
        return
      }
      savedProviderSettings = getActiveProviderSettings(getInitialSettings())
      if (isSwitch) {
        await executePostModelSwitchHooks(hookDetails)
      }
    }

    if (hasToggledEffort) {
      const persistable = selectedEffort
        ? toPersistableEffort(selectedEffort)
        : undefined
      if (persistable !== undefined) {
        updateSettingsForSource('userSettings', {
          effortLevel: persistable,
        })
      }
    }

    if (hasToggledThinking) {
      updateSettingsForSource('userSettings', {
        alwaysThinkingEnabled: thinkingEnabled ? undefined : false,
      })
    }

    // Update app state
    setAppState(prev => ({
      ...prev,
      mainLoopModel: value,
      mainLoopModelForSession: null,
      nvidiaTaskModel: undefined,
      provider: {
        ...(prev.provider ?? {}),
        ...(savedProviderSettings ?? {
          active: selectedProvider?.value,
          model: value,
        }),
      },
      ...(hasToggledEffort ? { effortValue: selectedEffort } : {}),
      ...(hasToggledThinking ? { thinkingEnabled } : {}),
    }))

    onSelect(value, selectedEffort, selectedProvider ? {
      providerId: selectedProvider.value as ProviderId,
      providerName: selectedProvider.label,
      accessType: selectedProvider.accessType,
      modelSource,
      runtimeBackend: runtimeBackend ?? 'unknown',
    } : undefined)
  }

  function handleBack() {
    setStep('provider')
    setSelectedProvider(null)
    setModelOptions([])
    setModelWarning(null)
  }

  function handleKeySubmit() {
    if (!connectingProvider) return
    // Terminals deliver a bracketed paste as one chunk that can carry the
    // trailing newline from the copied line; a stored key must stay single-line.
    const key = sanitizeApiKeyInput(apiKeyInput)
    if (!key) {
      setConnectError('Enter your API key (or press Esc to go back).')
      return
    }
    const problem = describeApiKeyProblem(apiKeyInput)
    if (problem) {
      setConnectError(problem)
      return
    }
    const saved = setProviderApiKey(connectingProvider.value, key)
    if (!saved.ok) {
      setConnectError(saved.message)
      return
    }
    clearProviderModelCache(connectingProvider.value)
    const ready = providerPickerStatusWithoutNetwork(
      connectingProvider.provider,
      getInitialSettings(),
      'stored',
    )
    const readyProvider: ProviderStatusOption = {
      ...connectingProvider,
      status: ready.status,
      statusLabel: ready.label,
    }
    setProviderOptions(previous =>
      previous.map(option =>
        option.value === readyProvider.value ? readyProvider : option,
      ),
    )
    setApiKeyInput('')
    setApiKeyCursorOffset(0)
    setConnectError(null)
    setCredentialNotice(saved.message)
    // Selecting the provider triggers live model discovery with the new key.
    setSelectedProvider(readyProvider)
    setStep('model')
  }

  function handleKeyCancel() {
    setApiKeyInput('')
    setApiKeyCursorOffset(0)
    setEndpointInput('')
    setEndpointCursorOffset(0)
    if (connectReturnStep !== 'manage') {
      setConnectingProvider(null)
    }
    setConnectError(null)
    setStep(connectReturnStep)
  }

  function handleEndpointSubmit() {
    if (!connectingProvider) return
    const endpoint = endpointInput.trim()
    if (!endpoint) {
      setConnectError('Enter the provider endpoint (or press Esc to go back).')
      return
    }
    const providerId = connectingProvider.value as ProviderId
    const saved = setSafeProviderConfig('base_url', endpoint, {
      provider: providerId,
    })
    if (!saved.ok) {
      setConnectError(saved.message)
      return
    }
    clearProviderModelCache(providerId)
    const configured = providerPickerStatusWithoutNetwork(
      connectingProvider.provider,
      getInitialSettings(),
    )
    const pendingProvider: ProviderStatusOption = {
      ...connectingProvider,
      status: configured.status,
      statusLabel: `${configured.label}; endpoint saved`,
    }
    setProviderOptions(previous =>
      previous.map(option =>
        option.value === providerId ? pendingProvider : option,
      ),
    )
    setEndpointInput('')
    setEndpointCursorOffset(0)
    setConnectError(null)
    setCredentialNotice(saved.message)
    setSelectedProvider(pendingProvider)
    setFocusedModelValue(null)
    setStep('model')
  }

  function handleManageSelect(action: string) {
    if (!connectingProvider) return
    if (action === 'use') {
      setSelectedProvider(connectingProvider)
      setStep('model')
      setFocusedModelValue(null)
      return
    }
    if (action === 'replace') {
      setApiKeyInput('')
      setApiKeyCursorOffset(0)
      setConnectionMode('api-key')
      setConnectReturnStep('manage')
      setConnectError(null)
      setStep('connect')
      return
    }
    if (action === 'disconnect') {
      const cleared = clearProviderApiKey(connectingProvider.value)
      if (!cleared.ok) {
        setCredentialNotice(cleared.message)
        return
      }
      clearProviderModelCache(connectingProvider.value)
      setCredentialNotice(cleared.message)
      setProviderOptions(prev =>
        prev.map(opt =>
          opt.value === connectingProvider.value
            ? { ...opt, status: 'missing', statusLabel: 'No stored API key' }
            : opt,
        ),
      )
      setConnectingProvider(null)
      setStep('provider')
    }
  }

  function handleManageCancel() {
    setConnectingProvider(null)
    setStep('provider')
  }

  // Credential management for a provider whose key UR stores itself.
  if (step === 'manage' && connectingProvider) {
    const manageContent = (
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            {connectingProvider.label}
          </Text>
          <Text dimColor>
            Connected with an API key stored by UR. Choose an action, or press Esc to go back.
          </Text>
        </Box>
        <Select
          defaultValue="use"
          options={[
            {
              value: 'use',
              label: 'Continue to models',
              description: 'Keep the stored key and pick a model',
            },
            {
              value: 'replace',
              label: 'Change API key',
              description: 'Replace the stored key with a new one',
            },
            {
              value: 'disconnect',
              label: 'Disconnect',
              description: 'Remove the stored key from this machine',
            },
          ]}
          onChange={handleManageSelect}
          onCancel={handleManageCancel}
          visibleOptionCount={3}
        />
        {credentialNotice && (
          <Box marginTop={1}>
            <Text dimColor color="subtle">{credentialNotice}</Text>
          </Box>
        )}
      </Box>
    )
    return isStandaloneCommand ? <Pane color="permission">{manageContent}</Pane> : manageContent
  }

  // API key entry view (add a token from inside UR while it is running).
  if (step === 'connect' && connectingProvider) {
    const endpointConnection = connectionMode === 'endpoint'
    const envKey = connectingProvider.provider.envKey
    const content = (
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            {endpointConnection ? 'Configure' : 'Connect'} {connectingProvider.label}
          </Text>
          <Text dimColor>
            {endpointConnection
              ? 'Enter this provider’s endpoint. UR stores it separately, so switching providers never overwrites another local/server address.'
              : 'Paste your API key to use your own account. It is stored securely in your OS keychain and reused automatically — you only do this once.'}
          </Text>
          {!endpointConnection && envKey && (
            <Text dimColor color="subtle">
              Equivalent to setting {envKey}. Get a key from the provider's dashboard.
            </Text>
          )}
        </Box>
        <Box width="100%" flexDirection="row">
          <Box width={12} flexShrink={0}>
            <Text bold color="subtle">{endpointConnection ? 'Endpoint' : 'API key'}</Text>
          </Box>
          <Box flexGrow={1}>
            {!endpointConnection ? (
              <TextInput
                value={apiKeyInput}
                onChange={setApiKeyInput}
                onSubmit={handleKeySubmit}
                mask="*"
                placeholder="paste key, then Enter"
                focus={true}
                showCursor={true}
                multiline={false}
                columns={keyInputColumns}
                cursorOffset={apiKeyCursorOffset}
                onChangeCursorOffset={setApiKeyCursorOffset}
              />
            ) : (
              <TextInput
                value={endpointInput}
                onChange={setEndpointInput}
                onSubmit={handleEndpointSubmit}
                placeholder="http://localhost:8080/v1"
                focus={true}
                showCursor={true}
                multiline={false}
                columns={keyInputColumns}
                cursorOffset={endpointCursorOffset}
                onChangeCursorOffset={setEndpointCursorOffset}
              />
            )}
          </Box>
        </Box>
        {connectError && (
          <Box marginTop={1}>
            <Text color="error">{connectError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Byline>
            <KeyboardShortcutHint shortcut="Enter" action={endpointConnection ? 'save endpoint & load models' : 'store key & load models'} />
            <KeyboardShortcutHint shortcut="Esc" action="back" />
          </Byline>
        </Box>
      </Box>
    )
    return isStandaloneCommand ? <Pane color="permission">{content}</Pane> : content
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
                    Status: <Text color={focusedProvider.status === 'connected' ? 'success' : focusedProvider.status === 'unknown' ? 'subtle' : 'error'}>{focusedProvider.status}</Text>
                    <Text dimColor> · {focusedProvider.statusLabel}</Text>
                  </Text>
                  <Text dimColor>
                    {focusedProvider.provider.accessPathLabel}
                  </Text>
                  <Text dimColor color={focusedProvider.runtimeBlockedReason ? 'error' : 'subtle'}>
                    Runtime: {focusedProvider.provider.runtimeKind === 'external-app' ? 'external app bridge (disabled for independent UR runtime)' : 'UR-native'}
                  </Text>
                  {focusedProvider.status !== 'connected' && focusedProvider.status !== 'unknown' && (
                    <Text dimColor color="subtle">
                      Not connected — run `ur connect {focusedProvider.value}` (subscription login or API key), then reselect. Troubleshoot: `ur provider doctor {focusedProvider.value}`
                    </Text>
                  )}
                  {providerWarning && focusedProvider.value === focusedProviderValue && (
                    <Text dimColor color="error">
                      {providerWarning}
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
            {selectedProvider?.value === 'openrouter'
              ? 'OpenRouter model catalog'
              : 'Select model'}
          </Text>
          <Text dimColor>
            {selectedProvider?.value === 'openrouter'
              ? `${modelOptions.length} models · live catalog cached for 5 minutes · Ctrl+R refreshes now`
              : selectedProvider?.value === 'nvidia-nim'
                ? `${modelOptions.length} ongoing agent models · exact NVIDIA agent endpoints`
                : selectedProvider?.value === 'nvidia-special'
                  ? `${modelOptions.length} focused-task entries · exact per-card NVIDIA inference contracts where published`
              : `Showing models for ${selectedProvider?.label} (${selectedProvider?.accessType})`}
          </Text>
          <Text color={modelSource === 'live' ? 'success' : modelSource === 'unavailable' ? 'error' : 'subtle'}>
            {selectedProvider?.value === 'nvidia-nim' && modelSource === 'live'
              ? '● NVIDIA AGENT ENDPOINTS'
              : selectedProvider?.value === 'nvidia-special'
                ? '○ NVIDIA SPECIAL CONTRACTS'
              : formatModelSourceLabel(modelSource)}
            <Text dimColor color="subtle">
              {' '}· {selectedProvider?.value === 'nvidia-special'
                ? 'selecting a model prepares one task and keeps the current chat model'
                : 'agent models continue the UR tool loop'}
            </Text>
          </Text>
          {credentialNotice && (
            <Text dimColor color="subtle">{credentialNotice}</Text>
          )}
          <Text dimColor color="subtle">
            ↑↓ browse · Enter select · ←→ effort/thinking · Ctrl+R refresh · Esc providers
            {selectedProvider &&
            providerSupportsEndpointEditing(selectedProvider.provider)
              ? ' · E endpoint'
              : ''}
            {selectedProvider &&
            providerSupportsApiKeyEditing(selectedProvider.provider)
              ? ' · K API key'
              : ''}
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
                <Text dimColor color="subtle">
                  Focused model · full name
                </Text>
                <Text bold color="text">
                  {fullProviderModelDisplayName(
                    selectedProvider?.value ?? '',
                    {
                      id: focusedModel.value,
                      displayName: focusedModel.label,
                    },
                  )}
                </Text>
                <Text dimColor>
                  {focusedModel.description}
                </Text>
                {focusedIsTaskModel && (
                  <Box flexDirection="column">
                    <Text color="remember" bold>
                      NVIDIA SPECIAL TASK · {focusedModel.taskKind}
                    </Text>
                    <Text dimColor>
                      {focusedModel.purpose}
                    </Text>
                    <Text dimColor color="subtle">
                      Enter prepares this model's exact inference contract for the next matching NVIDIA task. It never replaces the ongoing agent model.
                    </Text>
                  </Box>
                )}
                {focusedSupportsEffort && (
                  <Box flexDirection="column">
                    <Text>
                      <Text color="ur">
                        {effortLevelToSymbol(displayedEffort)}{' '}
                        {displayedEffort.toUpperCase()}
                      </Text>
                      <Text dimColor color="subtle">
                        {' '}provider effort · use ← → to adjust
                      </Text>
                    </Text>
                    <Text dimColor color="subtle">
                      Available levels: {focusedEffortLevelLabels.join(' · ')}
                    </Text>
                  </Box>
                )}
                {!focusedIsTaskModel && !focusedSupportsEffort && effortCapabilityLoading && (
                  <Text dimColor color="subtle">
                    Checking this model's provider effort levels…
                  </Text>
                )}
                {!focusedIsTaskModel && !focusedSupportsEffort && !effortCapabilityLoading && (
                  <Text dimColor color="subtle">
                    {focusedSupportsThinking
                      ? 'Thinking supported; no model-specific graded ladder advertised. Using provider-native on/off control.'
                      : focusedAdvertisesThinking
                        ? 'Thinking supported; this runtime advertises no controllable graded ladder or on/off mapping.'
                        : 'Graded effort not advertised for this model.'}
                  </Text>
                )}
                {!focusedIsTaskModel && focusedSupportsThinking && (
                  <Text dimColor>
                    <Text color={thinkingEnabled ? 'ur' : 'subtle'}>
                      {thinkingEnabled ? '◆' : '◇'}
                    </Text>{' '}
                    Thinking {thinkingEnabled ? 'ON' : 'OFF'}{' '}
                    <Text dimColor color="subtle">
                      {focusedSupportsEffort
                        ? 't to toggle'
                        : '← off · → on · t toggle'}
                    </Text>
                  </Text>
                )}
                {effortCapabilityWarning && (
                  <Text dimColor color="error">
                    {effortCapabilityWarning}
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
                  Press ctrl+r to retry{selectedProvider && providerSupportsEndpointEditing(selectedProvider.provider) ? ', E to change the endpoint' : ''}{selectedProvider && providerSupportsApiKeyEditing(selectedProvider.provider) ? ', or K to add/change its API key' : ''}, or run `ur provider doctor {selectedProvider?.value}` to troubleshoot.
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

export type ProviderPickerStatus = {
  status: ProviderConnectionStatus
  label: string
}

/**
 * Whether the provider exposes an HTTP endpoint users can override from the
 * picker. API providers count too: their official URL is only a default, not a
 * hard-coded destination.
 */
export function providerSupportsEndpointEditing(
  provider: ProviderDefinition,
): boolean {
  return (
    provider.credentialType === 'openai-compatible-endpoint' ||
    provider.credentialType === 'local-runtime' ||
    provider.defaultBaseUrl !== undefined
  )
}

/** Whether the picker can securely add or replace this provider's API key. */
export function providerSupportsApiKeyEditing(
  provider: ProviderDefinition,
): boolean {
  return provider.accessType !== 'subscription' && Boolean(provider.envKey)
}

/**
 * Build the provider-list status from configuration and credential presence
 * only. Network verification is deliberately deferred until selection, where
 * the same live request also supplies the model catalogue.
 */
export function providerPickerStatusWithoutNetwork(
  provider: ProviderDefinition,
  settings: Parameters<typeof getScopedProviderBaseUrl>[1] = getInitialSettings(),
  apiKeySource: ApiKeySource = getProviderApiKeySource(provider.id),
): ProviderPickerStatus {
  const needsApiKey =
    provider.credentialType === 'api-key' || provider.requiresApiKey === true
  if (needsApiKey && apiKeySource === 'none') {
    return {
      status: 'missing',
      label: `${provider.envKey ?? 'API key'} required`,
    }
  }

  if (provider.credentialType === 'api-key') {
    return {
      status: 'connected',
      label:
        apiKeySource === 'stored'
          ? 'Stored API key ready'
          : 'Environment API key ready',
    }
  }

  if (
    provider.credentialType === 'openai-compatible-endpoint' ||
    provider.credentialType === 'local-runtime'
  ) {
    const endpoint =
      getScopedProviderBaseUrl(provider.id, settings) ?? provider.defaultBaseUrl
    if (!endpoint) {
      return { status: 'missing', label: 'Endpoint required' }
    }
    return {
      status: 'unknown',
      label: provider.requiresApiKey
        ? `${apiKeySource === 'stored' ? 'Stored' : 'Environment'} API key and endpoint ready; checked when selected`
        : 'Endpoint configured; checked when selected',
    }
  }

  return { status: 'unknown', label: 'Checked when selected' }
}

export function getProviderKeyInputColumns(terminalColumns?: number): number {
  const columns =
    Number.isFinite(terminalColumns) && (terminalColumns as number) > 0
      ? Math.floor(terminalColumns as number)
      : 80
  return Math.max(8, columns - 20)
}

export function cycleProviderPickerEffort(
  current: EffortLevel,
  direction: 'left' | 'right',
  supportedLevels: readonly EffortLevel[],
): EffortLevel {
  const levels = supportedLevels.length > 0 ? [...supportedLevels] : [current]
  const index = levels.indexOf(current)
  const currentIndex = index >= 0 ? index : levels.indexOf('high')
  const delta = direction === 'right' ? 1 : -1
  return levels[(currentIndex + delta + levels.length) % levels.length]!
}

export function formatModelSourceLabel(source: ProviderModelSource): string {
  if (source === 'live') return '● LIVE CATALOG'
  if (source === 'cache') return '◐ CACHED CATALOG'
  if (source === 'unavailable') return '× CATALOG UNAVAILABLE'
  return '○ BUILT-IN CATALOG'
}

export function formatProviderModelDescription(
  model: ProviderModelDefinition,
  source: ProviderModelSource,
  providerId: ProviderId,
): string {
  if (providerId === 'nvidia-special' && model.usageMode === 'task') {
    const executable = model.capabilities?.executable !== false
    const transport =
      typeof model.capabilities?.transport === 'string'
        ? model.capabilities.transport.toUpperCase()
        : 'NVIDIA'
    return executable
      ? `${model.description} · ${transport} · exact NVIDIA inference contract`
      : `${model.description} · NVIDIA has not published an invocation contract`
  }
  if (providerId !== 'openrouter') {
    return `${model.description} · ${source}`
  }

  const details: string[] = []
  if (model.pricing === 'free') details.push('FREE')
  else if (model.pricing === 'paid') details.push('PAID')
  if (model.contextLength) {
    details.push(
      model.contextLength >= 1_000_000
        ? `${Math.round(model.contextLength / 1_000_000)}M context`
        : `${Math.round(model.contextLength / 1_000)}K context`,
    )
  }
  if (model.supportedParameters?.includes('tools')) details.push('tools')
  else if (model.supportedParameters) details.push('chat only')
  if (
    model.reasoning ||
    model.supportedParameters?.some(
      parameter =>
        parameter === 'reasoning' || parameter === 'reasoning_effort',
    )
  ) {
    details.push('reasoning')
  }
  return details.length > 0 ? details.join(' · ') : model.description
}
