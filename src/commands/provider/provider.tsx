import { _c } from 'react/compiler-runtime'
import chalk from 'chalk'
import * as React from 'react'
import { ProviderPicker } from '../../components/ProviderPicker.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  getProviderRuntimeInfo,
  resolveProviderId,
  type ProviderSettings,
} from '../../services/providers/providerRegistry.js'
import { useSettings } from '../../hooks/useSettings.js'

function ApplyProviderAndClose({
  provider,
  message,
  onDone,
}: {
  provider: ProviderSettings
  message: string
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const setAppState = useSetAppState()

  React.useEffect(() => {
    setAppState(prev => ({
      ...prev,
      provider: {
        ...(prev.provider ?? {}),
        ...provider,
      },
    }))
    onDone(message)
  }, [message, onDone, provider, setAppState])

  return null
}

function ProviderPickerWrapper({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const settings = useSettings()
  const providerRuntime = getProviderRuntimeInfo(settings)
  const setAppState = useSetAppState()

  function handleCancel(): void {
    logEvent('tengu_provider_command_menu', {
      action: 'cancel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    const displayProvider = providerRuntime.providerLabel
    onDone(`Kept provider as ${chalk.bold(displayProvider)}`, {
      display: 'system',
    })
  }

  function handleSelect(provider: string): void {
    const resolvedProvider = resolveProviderId(provider)
    if (!resolvedProvider) {
      onDone(`Unknown provider "${provider}".`, { display: 'system' })
      return
    }
    if (resolvedProvider === 'subscription') {
      onDone(
        'Choose a concrete subscription provider (Codex CLI, Claude Code, Gemini CLI, or Antigravity).',
        { display: 'system' },
      )
      return
    }
    logEvent('tengu_provider_command_menu', {
      action: resolvedProvider as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      from_provider: providerRuntime.provider as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_provider: resolvedProvider as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    const newProviderRuntime = getProviderRuntimeInfo({
      provider: { active: resolvedProvider },
    })

    let message = `Set provider to ${chalk.bold(newProviderRuntime.providerLabel)}`

    if (newProviderRuntime.model) {
      message += ` · Model: ${chalk.bold(newProviderRuntime.model)}`
    }

    if (newProviderRuntime.baseUrl) {
      message += ` · URL: ${newProviderRuntime.baseUrl}`
    }

    onDone(message)
  }

  return (
    <ProviderPicker
      initial={providerRuntime.provider}
      onSelect={handleSelect}
      onCancel={handleCancel}
      isStandaloneCommand={true}
    />
  )
}

function ShowProviderAndClose({
  onDone,
}: {
  onDone: (result?: string) => void
}): React.ReactNode {
  const settings = useSettings()
  const providerRuntime = getProviderRuntimeInfo(settings)

  let message = `Current provider: ${chalk.bold(providerRuntime.providerLabel)} (${providerRuntime.provider})`
  message += `\nAuth mode: ${providerRuntime.authLabel}`
  message += `\nProvider kind: ${providerRuntime.providerKind}`
  message += `\nUses external CLI: ${providerRuntime.usesExternalCli ? 'yes' : 'no'}`
  message += `\nUR-native tool calls: ${providerRuntime.supportsNativeToolCalls ? 'yes' : 'no'}`
  message += `\nUR-native streaming: ${providerRuntime.supportsNativeStreaming ? 'yes' : 'no'}`
  message += `\nRuntime backend: ${providerRuntime.runtimeBackend}`
  message += `\nSafety boundary: ${providerRuntime.safetyBoundaryLabel}`

  if (providerRuntime.model) {
    message += `\nModel: ${chalk.bold(providerRuntime.model)}`
  }

  if (providerRuntime.baseUrl) {
    message += `\nBase URL: ${providerRuntime.baseUrl}`
  }

  if (providerRuntime.fallback) {
    message += `\nFallback: ${providerRuntime.fallback}`
  }

  onDone(message)
  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || ''

  if (COMMON_INFO_ARGS.includes(args)) {
    logEvent('tengu_provider_command_inline_help', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return <ShowProviderAndClose onDone={onDone} />
  }

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Run /provider to open the provider selection menu, or /provider [providerId] to set the provider directly.',
      { display: 'system' },
    )
    return
  }

  if (args) {
    logEvent('tengu_provider_command_inline', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    // Direct provider setting via command args
    const {
      setSafeProviderConfig,
      validateProviderModelCompatibility,
      getActiveProviderSettings,
    } = await import('../../services/providers/providerRegistry.js')
    const { getInitialSettings } = await import('../../utils/settings/settings.js')

    const resolvedProvider = resolveProviderId(args)
    if (!resolvedProvider) {
      onDone(`Unknown provider "${args}". Run: /provider to see available providers.`, {
        display: 'system',
      })
      return
    }

    // Validate provider change with current model
    const settings = getInitialSettings()
    const currentModel = getActiveProviderSettings(settings).model
    if (currentModel) {
      const validation = validateProviderModelCompatibility(resolvedProvider, currentModel)
      if (validation.valid === false) {
        const validModelsStr = validation.validModels.join(', ') || '(uses dynamic discovery)'
        const suggestedModel = validation.suggestedModel ?? 'see available models'
        onDone(
          `Provider changed to ${chalk.bold(resolvedProvider)}, but current model "${currentModel}" is not available.\n` +
          `Valid models for ${resolvedProvider}: ${validModelsStr}\n` +
          `Run: /model ${suggestedModel}`,
          { display: 'system' },
        )
      }
    }

    const result = setSafeProviderConfig('provider', args)
    if (result.ok) {
      const saved = getActiveProviderSettings(getInitialSettings())
      return <ApplyProviderAndClose provider={saved} message={result.message} onDone={onDone} />
    } else {
      onDone(result.message, { display: 'system' })
    }
    return
  }

  return <ProviderPickerWrapper onDone={onDone} />
}
