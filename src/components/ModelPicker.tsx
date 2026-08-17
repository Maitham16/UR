// @ts-nocheck
import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useContext, useEffect, useState } from 'react'
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
} from 'src/utils/fastMode.js'
import { Box, Text, useInput } from '../ink.js'
import { TerminalSizeContext } from '../ink/components/TerminalSizeContext.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  getSupportedEffortLevelsForModel,
  modelSupportsEffort,
  resolveProviderEffortLevel,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import type { ModelOption } from '../utils/model/modelOptions.js'
import {
  getInitialSettings,
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import {
  modelSupportsThinking,
  shouldEnableThinkingByDefault,
} from '../utils/thinking.js'
import {
  getActiveProviderSettings,
  ensureProviderReasoningCapabilitiesForModel,
  listModelsForProviderWithSource,
  validateProviderModelPair,
} from '../services/providers/providerRegistry.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { effortLevelToSymbol } from './EffortIndicator.js'
import {
  buildProviderModelLabels,
  fullProviderModelDisplayName,
} from '../utils/model/modelPresentation.js'

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  showFastModeNotice?: boolean
  headerText?: string
  skipSettingsWrite?: boolean
}

const NO_PREFERENCE = '__NO_PREFERENCE__'

// Module-level selectors so useAppState keeps a stable reference (avoids
// re-subscribing the external store on every render).
const selectEffortValue = (s: { effortValue?: unknown }) => s.effortValue
const selectFastMode = (s: { fastMode?: boolean }) =>
  isFastModeEnabled() ? s.fastMode : false
const selectThinkingEnabled = (s: { thinkingEnabled?: boolean }) =>
  s.thinkingEnabled

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  isStandaloneCommand,
  showFastModeNotice,
  headerText,
  skipSettingsWrite,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const exitState = useExitOnCtrlCDWithKeybindings()
  const terminalSize = useContext(TerminalSizeContext)
  const initialValue = initial === null ? NO_PREFERENCE : initial
  const [focusedValue, setFocusedValue] = useState(initialValue)
  const isFastMode = useAppState(selectFastMode)
  const [hasToggledEffort, setHasToggledEffort] = useState(false)
  const effortValue = useAppState(selectEffortValue)
  const [effort, setEffort] = useState<EffortLevel | undefined>(
    effortValue !== undefined
      ? convertEffortValueToLevel(effortValue)
      : undefined,
  )
  // Thinking is a session/global setting (AppState.thinkingEnabled, persisted as
  // alwaysThinkingEnabled). Like effort, the toggle is only applied when the
  // user actually confirms a model. Seed from AppState, falling back to the
  // model-launch default.
  const appThinkingEnabled = useAppState(selectThinkingEnabled)
  const [hasToggledThinking, setHasToggledThinking] = useState(false)
  const [thinkingEnabled, setThinkingEnabled] = useState(
    () => appThinkingEnabled ?? shouldEnableThinkingByDefault(),
  )
  const [providerModelOptions, setProviderModelOptions] = useState<Array<ModelOption & { disabled?: boolean }>>([])
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [modelReloadToken, setModelReloadToken] = useState(0)
  const [effortCapabilityLoading, setEffortCapabilityLoading] = useState(false)
  const [effortCapabilityWarning, setEffortCapabilityWarning] = useState<string | null>(null)
  const effectiveSettings = getInitialSettings()
  const currentProvider =
    getActiveProviderSettings(effectiveSettings).active ?? 'ollama'

  // Load models for the current provider
  useEffect(() => {
    const controller = new AbortController()
    setLoadingModels(true)
    setPickerError(null)
    listModelsForProviderWithSource(currentProvider, {
      settings: effectiveSettings,
      signal: controller.signal,
      freshOnly: currentProvider === 'openrouter',
    })
      .then(result => {
        if (controller.signal.aborted) return
        const modelLabels = buildProviderModelLabels(
          currentProvider,
          result.models,
        )
        setProviderModelOptions(result.models.map(model => ({
          value: model.id,
          label: modelLabels.get(model.id) ?? model.displayName,
          description: `${model.description} · ${result.source}`,
          reasoning: model.reasoning,
          ...(model.supportedParameters !== undefined && !model.supportedParameters.includes('tools')
            ? { disabled: true }
            : {}),
        })))
        setPickerError(result.warning ?? null)
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setProviderModelOptions([])
        setPickerError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingModels(false)
      })
    return () => controller.abort()
  }, [currentProvider, modelReloadToken])

  // llama.cpp publishes the selected chat template's reasoning-effort support
  // on /props. Resolve the model under the arrow cursor, not the active model,
  // so Left/Right always receives that focused model's exact level list.
  useEffect(() => {
    if (currentProvider !== 'llama.cpp' || !focusedValue) {
      setEffortCapabilityLoading(false)
      setEffortCapabilityWarning(null)
      return
    }
    const focused = providerModelOptions.find(
      model => model.value === focusedValue,
    )
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
        currentProvider,
        focusedValue,
        {
          settings: effectiveSettings,
          signal: controller.signal,
        },
      )
        .then(reasoning => {
          if (cancelled) return
          setProviderModelOptions(previous =>
            previous.map(model =>
              model.value === focusedValue
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
  }, [currentProvider, focusedValue, providerModelOptions])

  useInput(
    (input, key) => {
      if (key.ctrl && (input === 'r' || input === 'R')) {
        setModelReloadToken(token => token + 1)
      }
    },
    { isActive: !loadingModels },
  )

  const modelOptions = providerModelOptions

  // If the agent's current model is a full ID not in the alias list, inject it
  // as an option so it can round-trip through confirm without being overwritten.
  const optionsWithInitial =
    initial !== null && validateProviderModelPair(currentProvider, initial, {
      availableModels: modelOptions.map(option => option.value),
    }).valid && !modelOptions.some(opt => opt.value === initial)
      ? [
          ...modelOptions,
          {
            value: initial,
            label: modelDisplayString(initial),
            description: 'Current model',
          },
        ]
      : modelOptions

  const selectOptions = optionsWithInitial.map(opt => ({
    ...opt,
    value: opt.value === null ? NO_PREFERENCE : opt.value,
  }))

  const initialFocusValue = selectOptions.some(o => o.value === initialValue)
    ? initialValue
    : (selectOptions[0]?.value ?? undefined)

  const visibleCount = getAdaptiveModelVisibleCount(
    selectOptions.length,
    terminalSize?.rows,
  )
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount)

  const focusedModelName = selectOptions.find(
    opt => opt.value === focusedValue,
  )?.label
  const focusedModelOption = selectOptions.find(
    opt => opt.value === focusedValue,
  )
  const focusedModel = resolveOptionModel(focusedValue)
  const focusedEffortLevels = focusedModel
    ? getSupportedEffortLevelsForModel(focusedModel, currentProvider)
    : []
  const focusedSupportsEffort = focusedModel
    ? modelSupportsEffort(focusedModel, currentProvider)
    : false
  const focusedSupportsThinking = focusedModel
    ? modelSupportsThinking(focusedModel)
    : false
  const focusedDefaultEffort = getDefaultEffortLevelForOption(
    focusedValue,
    currentProvider,
  )
  const displayEffort = focusedModel
    ? resolveProviderEffortLevel(
        focusedModel,
        effort ?? focusedDefaultEffort,
        currentProvider,
      ) ?? focusedDefaultEffort
    : focusedDefaultEffort

  const handleFocus = (value: string) => {
    setFocusedValue(value)
    if (!hasToggledEffort && effortValue === undefined) {
      setEffort(getDefaultEffortLevelForOption(value, currentProvider))
    }
  }

  const handleCycleEffort = (direction: 'left' | 'right') => {
    if (!focusedSupportsEffort) {
      return
    }
    setEffort(prev =>
      cycleEffortLevel(
        (focusedModel
          ? resolveProviderEffortLevel(
              focusedModel,
              prev ?? focusedDefaultEffort,
              currentProvider,
            )
          : undefined) ?? focusedDefaultEffort,
        direction,
        focusedEffortLevels,
      ),
    )
    setHasToggledEffort(true)
  }

  const handleToggleThinking = () => {
    if (!focusedSupportsThinking) {
      return
    }
    setThinkingEnabled(prev => !prev)
    setHasToggledThinking(true)
  }

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => handleCycleEffort('left'),
      'modelPicker:increaseEffort': () => handleCycleEffort('right'),
      'modelPicker:toggleThinking': handleToggleThinking,
    },
    { context: 'ModelPicker' },
  )

  function handleSelect(value: string) {
    const selectedModel = resolveOptionModel(value)
    const selectedEffort =
      hasToggledEffort && selectedModel && effort
        ? resolveProviderEffortLevel(selectedModel, effort, currentProvider)
        : undefined
    logEvent('tengu_model_command_menu_effort', {
      effort: selectedEffort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (value !== NO_PREFERENCE) {
      const validation = validateProviderModelPair(currentProvider, value, {
        availableModels: modelOptions.map(option => option.value),
      })
      if (validation.valid === false) {
        setPickerError(validation.error)
        return
      }
    }
    if (!skipSettingsWrite) {
      const effortLevel = resolvePickerEffortPersistence(
        hasToggledEffort ? selectedEffort : effort,
        getDefaultEffortLevelForOption(value, currentProvider),
        getSettingsForSource('userSettings')?.effortLevel,
        hasToggledEffort,
      )
      const persistable = toPersistableEffort(effortLevel)
      if (persistable !== undefined) {
        updateSettingsForSource('userSettings', {
          effortLevel: persistable,
        })
      }

      // Persist the thinking choice only if the user explicitly toggled it.
      // `undefined` follows the (thinking-on) default; `false` disables it.
      if (hasToggledThinking) {
        updateSettingsForSource('userSettings', {
          alwaysThinkingEnabled: thinkingEnabled ? undefined : false,
        })
      }

      setAppState(prev => ({
        ...prev,
        effortValue: effortLevel,
        ...(hasToggledThinking ? { thinkingEnabled } : {}),
      }))
    }
    if (value === NO_PREFERENCE) {
      onSelect(null, selectedEffort)
      return
    }
    onSelect(value, selectedEffort)
  }

  const fastModeNotice = isFastModeEnabled() ? (
    showFastModeNotice ? (
      <Box marginBottom={1}>
        <Text dimColor>
          Fast mode is <Text bold>ON</Text> and available with{' '}
          {FAST_MODE_MODEL_DISPLAY} only (/fast). Switching to other models turn
          off fast mode.
        </Text>
      </Box>
    ) : isFastModeAvailable() && !isFastModeCooldown() ? (
      <Box marginBottom={1}>
        <Text dimColor>
          Use <Text bold>/fast</Text> to turn on Fast mode (
          {FAST_MODE_MODEL_DISPLAY} only).
        </Text>
      </Box>
    ) : null
  ) : null

  const content = (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Select model
          </Text>
          <Text dimColor>
            {headerText ??
              'Switch between models for the active provider. Applies to this session and future UR sessions. For other provider-scoped model names, specify with --model.'}
          </Text>
          <Text dimColor color="subtle">
            ctrl+r refreshes the live model list for {currentProvider}
          </Text>
          {sessionModel && (
            <Text dimColor>
              Currently using {modelDisplayString(sessionModel)} for this session
              (set by plan mode). Selecting a model will undo this.
            </Text>
          )}
        </Box>
        {loadingModels ? (
          <Box marginBottom={1}>
            <Text dimColor>Loading current models...</Text>
          </Box>
        ) : selectOptions.length === 0 ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="error">No current models are available for {currentProvider}.</Text>
            <Text dimColor>Press ctrl+r to retry.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginBottom={1}>
            <Box flexDirection="column">
              <Select
                defaultValue={initialValue}
                defaultFocusValue={initialFocusValue}
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
            {focusedModelOption && focusedValue !== NO_PREFERENCE && (
              <Box paddingLeft={3} marginTop={1} flexDirection="column">
                <Text dimColor color="subtle">
                  Focused model · full name
                </Text>
                <Text bold color="text">
                  {fullProviderModelDisplayName(currentProvider, {
                    id: focusedModelOption.value,
                    displayName: String(focusedModelOption.label),
                  })}
                </Text>
              </Box>
            )}
          </Box>
        )}
        <Box marginBottom={1} flexDirection="column">
          {focusedSupportsEffort ? (
            <>
              <Text dimColor>
                <EffortLevelIndicator effort={displayEffort} />{' '}
                {capitalize(displayEffort)} effort
                {displayEffort === focusedDefaultEffort ? ' (default)' : ''}{' '}
                <Text color="subtle">← → to adjust</Text>
              </Text>
              <Text dimColor color="subtle">
                Provider levels: {focusedEffortLevels.join(' · ')}
              </Text>
            </>
          ) : (
            <Text color="subtle">
              <EffortLevelIndicator effort={undefined} /> Effort not supported
              {focusedModelName ? ` for ${focusedModelName}` : ''}
              {effortCapabilityLoading ? ' · checking provider…' : ''}
            </Text>
          )}
          {effortCapabilityWarning && (
            <Text color="warning">{effortCapabilityWarning}</Text>
          )}
          {focusedSupportsThinking ? (
            <Text dimColor>
              <Text color={thinkingEnabled ? 'ur' : 'subtle'}>
                {thinkingEnabled ? '◆' : '◇'}
              </Text>{' '}
              Thinking {thinkingEnabled ? 'on' : 'off'}{' '}
              <Text color="subtle">t to toggle</Text>
            </Text>
          ) : (
            <Text color="subtle">
              ◇ Thinking not supported
              {focusedModelName ? ` for ${focusedModelName}` : ''}
            </Text>
          )}
        </Box>
        {pickerError && (
          <Box marginBottom={1}>
            <Text color="error">{pickerError}</Text>
          </Box>
        )}
        {fastModeNotice}
      </Box>
      {isStandaloneCommand && (
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="select:cancel"
                context="Select"
                fallback="Esc"
                description="exit"
              />
            </Byline>
          )}
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

export function getAdaptiveModelVisibleCount(
  optionCount: number,
  terminalRows?: number,
): number {
  if (!Number.isFinite(optionCount) || optionCount <= 0) return 0
  const availableRows = Math.max(5, (terminalRows ?? 24) - 16)
  return Math.min(Math.floor(optionCount), availableRows)
}

function resolveOptionModel(value?: string): string | undefined {
  if (!value) return undefined
  return value === NO_PREFERENCE
    ? getDefaultMainLoopModel()
    : parseUserSpecifiedModel(value)
}

function EffortLevelIndicator({
  effort,
}: {
  effort: EffortLevel | undefined
}): React.ReactNode {
  const color = effort ? 'ur' : 'subtle'
  return <Text color={color}>{effortLevelToSymbol(effort ?? 'low')}</Text>
}

function cycleEffortLevel(
  current: EffortLevel,
  direction: 'left' | 'right',
  supportedLevels: readonly EffortLevel[],
): EffortLevel {
  const levels =
    supportedLevels.length > 0 ? [...supportedLevels] : [current]
  const idx = levels.indexOf(current)
  const currentIndex = idx !== -1 ? idx : levels.indexOf('high')
  if (direction === 'right') {
    return levels[(currentIndex + 1) % levels.length]!
  }
  return levels[(currentIndex - 1 + levels.length) % levels.length]!
}

function getDefaultEffortLevelForOption(
  value?: string,
  provider = getActiveProviderSettings(getInitialSettings()).active ?? 'ollama',
): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel()
  const levels = getSupportedEffortLevelsForModel(resolved, provider)
  const defaultValue = getDefaultEffortForModel(resolved, provider)
  if (defaultValue !== undefined) {
    return (
      resolveProviderEffortLevel(
        resolved,
        convertEffortValueToLevel(defaultValue),
        provider,
      ) ?? 'high'
    )
  }
  return levels.includes('high') ? 'high' : levels.at(-1) ?? 'high'
}
