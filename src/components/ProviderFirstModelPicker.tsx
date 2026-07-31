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
  getProviderRuntimeBlockReason,
  authAliasForProvider,
} from 'src/services/providers/providerRegistry.js'
import {
  clearProviderApiKey,
  getProviderApiKeySource,
  setProviderApiKey,
} from 'src/services/providers/providerCredentials.js'
import {
  describeApiKeyProblem,
  sanitizeApiKeyInput,
} from 'src/services/providers/apiKeyInput.js'
import { TerminalSizeContext } from '../ink/components/TerminalSizeContext.js'
import { useAppState, useSetAppState } from 'src/state/AppState.js'
import { getSettingsForSource } from 'src/utils/settings/settings.js'
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
  modelSupportsEffort,
} from '../utils/effort.js'
import {
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  shouldEnableThinkingByDefault,
} from '../utils/thinking.js'
import { resolveActiveProviderModel } from '../services/api/providerClient.js'

const selectCurrentProvider = (s: { provider?: { active?: string } }) =>
  s.provider?.active ?? 'ollama'
const selectEffortValue = (s: { effortValue?: unknown }) => s.effortValue
const selectThinkingEnabled = (s: { thinkingEnabled?: boolean }) => s.thinkingEnabled

type Step = 'provider' | 'connect' | 'manage' | 'model'

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
  const [connectError, setConnectError] = useState<string | null>(null)
  const [credentialNotice, setCredentialNotice] = useState<string | null>(null)
  // Bumping this re-runs discovery for the selected provider (the retry state).
  const [modelReloadToken, setModelReloadToken] = useState(0)
  const terminalSize = useContext(TerminalSizeContext)
  // "API key: " label plus the surrounding pane border.
  const keyInputColumns = Math.max(20, (terminalSize?.columns ?? 80) - 14)

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
      const providers = listProviders({ includeExternalAppBridges: true })
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
            description: `${accessType} · ${provider.credentialType} · ${provider.runtimeKind === 'external-app' ? 'external app bridge' : status.label}`,
            status: status.status,
            statusLabel: status.label,
            accessType,
            credentialType: provider.credentialType,
            runtimeBlockedReason: getProviderRuntimeBlockReason(provider.id),
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

    // Aborting the controller immediately after awaiting cancelled nothing and
    // left no way to drop a response for a provider the user had moved away
    // from. The controller now lives for the effect and is aborted on cleanup.
    const controller = new AbortController()
    let cancelled = false

    async function loadModels() {
      setLoadingModels(true)
      setModelWarning(null)
      const providerId = selectedProvider.value as ProviderId
      try {
        const result = await listModelsForProviderWithSource(providerId, {
          settings: getSettingsForSource('userSettings') ?? undefined,
          signal: controller.signal,
        })
        if (cancelled) return
        const options: Array<ModelOption & { disabled?: boolean }> = result.models.map(model => ({
          value: model.id,
          label: model.displayName,
          description: `${model.description} · ${result.source}`,
          ...(model.supportedParameters !== undefined && !model.supportedParameters.includes('tools')
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
  }, [selectedProvider, modelReloadToken])

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

  function handleProviderFocus(value: string) {
    setFocusedProviderValue(value)
    setProviderWarning(null)
  }

  function handleModelFocus(value: string) {
    setFocusedModelValue(value)
  }

  function handleProviderSelect(value: string) {
    const provider = providerOptions.find(p => p.value === value)
    if (provider) {
      if (provider.runtimeBlockedReason) {
        setProviderWarning(provider.runtimeBlockedReason)
        return
      }
      if (provider.status === 'connected' && provider.credentialType === 'api-key') {
        // A key UR itself stores can be replaced or removed from here. An
        // env-var key belongs to the shell, so there is nothing to manage.
        if (getProviderApiKeySource(provider.value) === 'stored') {
          setConnectingProvider(provider)
          setCredentialNotice(null)
          setConnectError(null)
          setStep('manage')
          return
        }
      }
      if (provider.status !== 'connected') {
        if (provider.credentialType === 'api-key') {
          // Add the API key right here, while UR is running, then load models.
          setConnectingProvider(provider)
          setApiKeyInput('')
          setApiKeyCursorOffset(0)
          setConnectError(null)
          setStep('connect')
          return
        }
        if (provider.provider.accessType === 'subscription') {
          setProviderWarning(`${provider.label} is not logged in. Sign in with \`ur auth ${authAliasForProvider(provider.value)}\` (uses your own subscription), then reselect.`)
          return
        }
        setProviderWarning(`Provider "${provider.value}" is ${provider.status}: ${provider.statusLabel}. Run \`ur provider doctor ${provider.value}\`, or choose a connected API/local/server provider.`)
        return
      }
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
    let runtimeBackend: string | undefined
    if (selectedProvider) {
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
    setApiKeyInput('')
    setApiKeyCursorOffset(0)
    setConnectError(null)
    setCredentialNotice(saved.message)
    // Selecting the provider triggers live model discovery with the new key.
    setSelectedProvider(connectingProvider)
    setStep('model')
  }

  function handleKeyCancel() {
    setApiKeyInput('')
    setApiKeyCursorOffset(0)
    setConnectingProvider(null)
    setConnectError(null)
    setStep('provider')
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
    const envKey = connectingProvider.provider.envKey
    const content = (
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Connect {connectingProvider.label}
          </Text>
          <Text dimColor>
            Paste your API key to use your own account. It is stored securely in your OS keychain and reused automatically — you only do this once.
          </Text>
          {envKey && (
            <Text dimColor color="subtle">
              Equivalent to setting {envKey}. Get a key from the provider's dashboard.
            </Text>
          )}
        </Box>
        <Box>
          <Text>{'API key: '}</Text>
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
        </Box>
        {connectError && (
          <Box marginTop={1}>
            <Text color="error">{connectError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="store key & load models" />
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
                    Status: <Text color={focusedProvider.status === 'connected' ? 'success' : 'error'}>{focusedProvider.status}</Text>
                    <Text dimColor> · {focusedProvider.statusLabel}</Text>
                  </Text>
                  <Text dimColor>
                    {focusedProvider.provider.accessPathLabel}
                  </Text>
                  <Text dimColor color={focusedProvider.runtimeBlockedReason ? 'error' : 'subtle'}>
                    Runtime: {focusedProvider.provider.runtimeKind === 'external-app' ? 'external app bridge (disabled for independent UR runtime)' : 'UR-native'}
                  </Text>
                  {focusedProvider.status !== 'connected' && (
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
            Esc to change provider · ctrl+r to refresh from {selectedProvider?.label}
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
                  Press ctrl+r to retry, or run `ur provider doctor {selectedProvider?.value}` to troubleshoot.
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
