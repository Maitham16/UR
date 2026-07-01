// @ts-nocheck
import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
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
import { Box, Text } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import { getModelOptions, type ModelOption } from '../utils/model/modelOptions.js'
import {
  getOllamaModelOptions,
  mergeModelOptions,
} from '../utils/model/ollamaModels.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import {
  modelSupportsThinking,
  shouldEnableThinkingByDefault,
} from '../utils/thinking.js'
import {
  listModelsForProvider,
  isModelSupportedByProvider,
  validateProviderModelCompatibility,
} from '../services/providers/providerRegistry.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

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
  const [ollamaModelOptions, setOllamaModelOptions] = useState<ModelOption[]>([])
  const [providerModelOptions, setProviderModelOptions] = useState<ModelOption[]>([])
  const currentProvider = getAPIProvider()
  const isOllamaProvider = currentProvider === 'ollama'
  const isLocalProvider = ['ollama', 'lmstudio', 'llama.cpp', 'vllm'].includes(currentProvider)

  // Load models for the current provider
  useEffect(() => {
    // For Ollama and other local providers, use dynamic discovery
    if (isOllamaProvider) {
      const controller = new AbortController()
      getOllamaModelOptions(controller.signal)
        .then(options => {
          if (!controller.signal.aborted) {
            setOllamaModelOptions(options)
            setProviderModelOptions(options)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setOllamaModelOptions([])
            setProviderModelOptions([])
          }
        })
      return () => controller.abort()
    }

    // For other local providers with dynamic discovery
    if (isLocalProvider) {
      const controller = new AbortController()
      getOllamaModelOptions(controller.signal)
        .then(options => {
          if (!controller.signal.aborted) {
            setProviderModelOptions(options)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setProviderModelOptions([])
          }
        })
      return () => controller.abort()
    }

    // For API providers, get models from the provider registry
    const models = listModelsForProvider(currentProvider)
    if (models.length > 0) {
      const options = models.map(model => ({
        value: model.id,
        label: model.displayName,
        description: model.description,
      }))
      setProviderModelOptions(options)
    } else {
      setProviderModelOptions([])
    }
  }, [currentProvider, isOllamaProvider, isLocalProvider])

  const baseModelOptions = getModelOptions(isFastMode ?? false)
  // For local providers, use only discovered models. For API providers, use provider-specific models.
  const modelOptions = isLocalProvider
    ? providerModelOptions
    : providerModelOptions.length > 0
      ? providerModelOptions
      : mergeModelOptions(baseModelOptions, ollamaModelOptions)

  // If the agent's current model is a full ID not in the alias list, inject it
  // as an option so it can round-trip through confirm without being overwritten.
  const optionsWithInitial =
    initial !== null && !modelOptions.some(opt => opt.value === initial)
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

  const visibleCount = Math.min(10, selectOptions.length)
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount)

  const focusedModelName = selectOptions.find(
    opt => opt.value === focusedValue,
  )?.label
  const focusedModel = resolveOptionModel(focusedValue)
  const focusedSupportsEffort = focusedModel
    ? modelSupportsEffort(focusedModel)
    : false
  const focusedSupportsMax = focusedModel
    ? modelSupportsMaxEffort(focusedModel)
    : false
  const focusedSupportsThinking = focusedModel
    ? modelSupportsThinking(focusedModel)
    : false
  const focusedDefaultEffort = getDefaultEffortLevelForOption(focusedValue)
  const displayEffort = effort === 'max' && !focusedSupportsMax ? 'high' : effort

  const handleFocus = (value: string) => {
    setFocusedValue(value)
    if (!hasToggledEffort && effortValue === undefined) {
      setEffort(getDefaultEffortLevelForOption(value))
    }
  }

  const handleCycleEffort = (direction: 'left' | 'right') => {
    if (!focusedSupportsEffort) {
      return
    }
    setEffort(prev =>
      cycleEffortLevel(
        prev ?? focusedDefaultEffort,
        direction,
        focusedSupportsMax,
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
    logEvent('tengu_model_command_menu_effort', {
      effort: effort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (!skipSettingsWrite) {
      const effortLevel = resolvePickerEffortPersistence(
        effort,
        getDefaultEffortLevelForOption(value),
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
    const selectedModel = resolveOptionModel(value)
    const selectedEffort =
      hasToggledEffort && selectedModel && modelSupportsEffort(selectedModel)
        ? effort
        : undefined
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
              'Switch between UR models. Applies to this session and future UR sessions. For other/previous model names, specify with --model.'}
          </Text>
          {sessionModel && (
            <Text dimColor>
              Currently using {modelDisplayString(sessionModel)} for this session
              (set by plan mode). Selecting a model will undo this.
            </Text>
          )}
        </Box>
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
        </Box>
        <Box marginBottom={1} flexDirection="column">
          {focusedSupportsEffort ? (
            <Text dimColor>
              <EffortLevelIndicator effort={displayEffort} />{' '}
              {capitalize(displayEffort)} effort
              {displayEffort === focusedDefaultEffort ? ' (default)' : ''}{' '}
              <Text color="subtle">← → to adjust</Text>
            </Text>
          ) : (
            <Text color="subtle">
              <EffortLevelIndicator effort={undefined} /> Effort not supported
              {focusedModelName ? ` for ${focusedModelName}` : ''}
            </Text>
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
  includeMax: boolean,
): EffortLevel {
  const levels: EffortLevel[] = includeMax
    ? ['low', 'medium', 'high', 'max']
    : ['low', 'medium', 'high']
  const idx = levels.indexOf(current)
  const currentIndex = idx !== -1 ? idx : levels.indexOf('high')
  if (direction === 'right') {
    return levels[(currentIndex + 1) % levels.length]!
  }
  return levels[(currentIndex - 1 + levels.length) % levels.length]!
}

function getDefaultEffortLevelForOption(value?: string): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel()
  const defaultValue = getDefaultEffortForModel(resolved)
  return defaultValue !== undefined
    ? convertEffortValueToLevel(defaultValue)
    : 'high'
}
