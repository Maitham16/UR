/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { writeSync } from 'node:fs'
import {
  formatProviderDoctor,
  formatProviderList,
  formatProviderStatus,
  getActiveProviderSettings,
  getProviderDefinition,
  listModelsForProviderWithSource,
  launchProviderAuth,
  type ProviderId,
  resolveProviderId,
  setProviderModel,
  setSafeProviderConfig,
  doctorProvider,
  validateProviderModelCompatibility,
} from '../../services/providers/providerRegistry.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

type JsonOption = {
  json?: boolean
}

function writeOutput(text: string): void {
  /* eslint-disable-next-line custom-rules/no-sync-fs -- subcommands call process.exit; async stdout can be dropped on CI */
  writeSync(1, text.endsWith('\n') ? text : `${text}\n`)
}

function writeError(text: string): void {
  /* eslint-disable-next-line custom-rules/no-sync-fs -- subcommands call process.exit; async stderr can be dropped on CI */
  writeSync(2, text.endsWith('\n') ? text : `${text}\n`)
}

export async function providerListHandler(options: JsonOption = {}): Promise<void> {
  writeOutput(formatProviderList(Boolean(options.json)))
  process.exit(0)
}

export async function providerStatusHandler(options: JsonOption = {}): Promise<void> {
  const settings = getInitialSettings()
  const active = getActiveProviderSettings(settings).active ?? 'ollama'
  const result = await doctorProvider(active, { settings })
  writeOutput(formatProviderStatus(result, Boolean(options.json)))
  process.exit(result.ok ? 0 : 1)
}

export async function providerDoctorHandler(
  providerArg: string | undefined,
  options: JsonOption = {},
): Promise<void> {
  let provider: ProviderId | undefined
  if (providerArg) {
    const resolved = resolveProviderId(providerArg)
    if (!resolved) {
      writeError(`Unknown provider "${providerArg}". Run: ur provider list`)
      process.exit(1)
    }
    provider = resolved
  }

  const settings = getInitialSettings()
  const active = getActiveProviderSettings(settings).active ?? 'ollama'
  const result = await doctorProvider(provider ?? active, { settings })
  writeOutput(formatProviderDoctor(result, Boolean(options.json)))
  process.exit(result.ok ? 0 : 1)
}

export async function providerModelsHandler(
  providerArg: string | undefined,
  options: JsonOption = {},
): Promise<void> {
  const settings = getInitialSettings()
  const active = getActiveProviderSettings(settings).active ?? 'ollama'
  const provider = providerArg ? resolveProviderId(providerArg) : active
  if (!provider) {
    writeError(`Unknown provider "${providerArg}". Run: ur provider list`)
    process.exit(1)
  }

  const result = await listModelsForProviderWithSource(provider, { settings })
  const definition = getProviderDefinition(provider)
  const payload = {
    provider,
    displayName: definition.displayName,
    source: result.source,
    warning: result.warning,
    models: result.models,
  }

  if (options.json) {
    writeOutput(JSON.stringify(payload, null, 2))
  } else {
    const warning = result.warning ? [`Warning: ${result.warning}`] : []
    writeOutput(
      [
        `Provider: ${definition.displayName} (${provider})`,
        `Model source: ${result.source}`,
        ...warning,
        ...result.models.map(model => `${model.id}${model.isDefault ? ' (default)' : ''} - ${model.description}`),
      ].join('\n'),
    )
  }
  process.exit(result.models.length > 0 ? 0 : 1)
}

export async function providerSelectModelHandler(
  providerArg: string,
  values: string | string[],
  options: JsonOption = {},
): Promise<void> {
  const model = Array.isArray(values) ? values.join(' ') : values
  const provider = resolveProviderId(providerArg)
  if (!provider) {
    const message = `Unknown provider "${providerArg}". Run: ur provider list`
    if (options.json) writeOutput(JSON.stringify({ ok: false, message }, null, 2))
    else writeError(message)
    process.exit(1)
  }

  const settings = getInitialSettings()
  const discovered = await listModelsForProviderWithSource(provider, { settings })
  const result = setProviderModel(provider, model, {
    availableModels: discovered.models,
    modelSource: discovered.source,
  })
  if (options.json) {
    writeOutput(
      JSON.stringify(
        {
          ...result,
          warning: discovered.warning,
        },
        null,
        2,
      ),
    )
  } else if (result.ok) {
    writeOutput(result.message)
    if (discovered.warning) writeError(`Warning: ${discovered.warning}`)
  } else {
    writeError(result.message)
  }
  process.exit(result.ok ? 0 : 1)
}

export async function providerAuthHandler(
  alias: 'chatgpt' | 'claude' | 'gemini' | 'antigravity',
  options: {
    deviceAuth?: boolean
    dryRun?: boolean
    json?: boolean
  } = {},
): Promise<void> {
  const result = await launchProviderAuth(alias, {
    deviceAuth: options.deviceAuth,
    dryRun: options.dryRun,
  })

  if (options.json) {
    writeOutput(JSON.stringify(result, null, 2))
  } else if (result.ok) {
    writeOutput(result.message)
  } else {
    writeError(result.message)
  }
  process.exit(result.ok ? 0 : 1)
}

export async function configSetHandler(
  key: string,
  values: string | string[],
): Promise<void> {
  const value = Array.isArray(values) ? values.join(' ') : values
  if (
    key !== 'provider' &&
    key !== 'provider.fallback' &&
    key !== 'provider.command_path' &&
    key !== 'openai_transport' &&
    key !== 'responses.store' &&
    key !== 'responses.compact_threshold' &&
    key !== 'responses.tool_search' &&
    key !== 'model' &&
    key !== 'base_url'
  ) {
    writeError(
      `Unsupported config key "${key}". Supported: provider, provider.fallback, provider.command_path, openai_transport, responses.store, responses.compact_threshold, responses.tool_search, model, base_url`,
    )
    process.exit(1)
  }

  // Validate provider/model compatibility when setting model
  if (key === 'model') {
    const settings = getInitialSettings()
    const currentProvider = getActiveProviderSettings(settings).active ?? 'ollama'
    const validation = validateProviderModelCompatibility(currentProvider, value)
    if (validation.valid === false) {
      writeError(`Invalid model for current provider:
  Selected provider: ${currentProvider}
  Selected model: ${value}
  Valid models for ${currentProvider}: ${validation.validModels.join(', ') || '(no models discovered)'}
  Suggested action: Run /model and choose a model from ${currentProvider}${validation.suggestedModel ? `, or run: ur config set model ${validation.suggestedModel}` : ''}
  Error: ${validation.error}`)
      process.exit(1)
    }
  }

  // When setting provider, validate that current model is compatible
  if (key === 'provider') {
    const settings = getInitialSettings()
    const currentModel = getActiveProviderSettings(settings).model
    if (currentModel) {
      const newProvider = resolveProviderId(value)
      if (newProvider) {
        const validation = validateProviderModelCompatibility(newProvider, currentModel)
        if (validation.valid === false) {
          const validModelsStr = validation.validModels.join(', ') || '(uses dynamic discovery)'
          const suggestedModel = validation.suggestedModel ?? '<model-name>'
          writeError(`Warning: Current model "${currentModel}" is not available for provider "${newProvider}" and will be cleared.
  Valid models for ${newProvider}: ${validModelsStr}
  After changing provider, run /model or: ur config set model ${suggestedModel}`)
          // Continue with provider change, but warn user
        }
      }
    }
  }

  const result = setSafeProviderConfig(key, value)
  if (result.ok) {
    writeOutput(result.message)
    process.exit(0)
  }
  writeError(result.message)
  process.exit(1)
}
