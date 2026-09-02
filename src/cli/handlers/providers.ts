/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { writeSync } from 'node:fs'
import {
  formatProviderDoctor,
  formatProviderList,
  formatProviderStatus,
  ensureProviderModelsFresh,
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
import {
  executePostModelSwitchHooks,
  executePreModelSwitchHooks,
  hasBlockingResult,
  type ModelSwitchHookDetails,
} from '../../utils/hooks.js'

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
  const discovered = await ensureProviderModelsFresh(provider, { settings, force: true })
  const validation = validateProviderModelCompatibility(provider, model, {
    availableModels: discovered.models,
    settings,
  })
  if (validation.valid === false) {
    const result = { ok: false as const, message: validation.error }
    if (options.json) writeOutput(JSON.stringify(result, null, 2))
    else writeError(result.message)
    process.exit(1)
  }
  const previous = getActiveProviderSettings(settings)
  const hookDetails: ModelSwitchHookDetails = {
    fromProvider: previous.active,
    fromModel: previous.model,
    toProvider: provider,
    toModel: model,
    source: 'cli',
  }
  const isSwitch = previous.active !== provider || previous.model !== model
  if (isSwitch) {
    const preResults = await executePreModelSwitchHooks(hookDetails)
    if (hasBlockingResult(preResults)) {
      const reason = preResults
        .filter(result => result.blocked)
        .map(result => result.output.trim())
        .filter(Boolean)
        .join('\n')
      const result = {
        ok: false as const,
        message: `Model switch blocked by PreModelSwitch hook${reason ? `: ${reason}` : '.'}`,
      }
      if (options.json) writeOutput(JSON.stringify(result, null, 2))
      else writeError(result.message)
      process.exit(1)
    }
  }
  const result = setProviderModel(provider, model, {
    availableModels: discovered.models,
    modelSource: discovered.source,
  })
  if (result.ok && isSwitch) {
    await executePostModelSwitchHooks(hookDetails)
  }
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

export const PROVIDER_CONFIG_KEYS = [
  'provider',
  'provider.fallback',
  'provider.command_path',
  'openai_transport',
  'responses.store',
  'responses.compact_threshold',
  'responses.tool_search',
  'openrouter.routing',
  'openrouter.allow_fallbacks',
  'openrouter.require_parameters',
  'openrouter.preferred_min_throughput',
  'openrouter.preferred_max_latency',
  'openrouter.service_tier',
  'openrouter.speed',
  'anthropic.speed',
  'anthropic.workspace_id',
  'model',
  'base_url',
] as const

export type ProviderConfigKey = (typeof PROVIDER_CONFIG_KEYS)[number]

export function parseProviderConfigSetValue(
  key: string,
  values: string | string[],
):
  | { ok: true; value: string; targetBaseUrlProvider?: ProviderId }
  | { ok: false; message: string } {
  const parts = Array.isArray(values) ? values : [values]
  if (key !== 'base_url' || parts.length <= 1) {
    return { ok: true, value: parts.join(' ') }
  }
  const targetBaseUrlProvider = resolveProviderId(parts[0]!)
  if (!targetBaseUrlProvider) {
    return {
      ok: false,
      message: `Unknown provider "${parts[0]}". Use: ur config set base_url <provider> <url>`,
    }
  }
  return {
    ok: true,
    value: parts.slice(1).join(' '),
    targetBaseUrlProvider,
  }
}

export async function providerConfigSetHandler(
  key: string,
  values: string | string[],
): Promise<void> {
  const parsedValue = parseProviderConfigSetValue(key, values)
  if ('message' in parsedValue) {
    writeError(parsedValue.message)
    process.exit(1)
  }
  const { value, targetBaseUrlProvider } = parsedValue
  if (!PROVIDER_CONFIG_KEYS.includes(key as ProviderConfigKey)) {
    writeError(
      `Unsupported provider config key "${key}". Supported: ${PROVIDER_CONFIG_KEYS.join(', ')}`,
    )
    process.exit(1)
  }

  let switchHookDetails: ModelSwitchHookDetails | undefined

  // Validate provider/model compatibility when setting model
  if (key === 'model') {
    const settings = getInitialSettings()
    const currentProvider = getActiveProviderSettings(settings).active ?? 'ollama'
    const discovered = await ensureProviderModelsFresh(currentProvider, { settings, force: true })
    const validation = validateProviderModelCompatibility(currentProvider, value, {
      availableModels: discovered.models,
      settings,
    })
    if (validation.valid === false) {
      writeError(`Invalid model for current provider:
  Selected provider: ${currentProvider}
  Selected model: ${value}
  Valid models for ${currentProvider}: ${validation.validModels.join(', ') || '(no models discovered)'}
  Suggested action: Run /model and choose a model from ${currentProvider}${validation.suggestedModel ? `, or run: ur config set model ${validation.suggestedModel}` : ''}
      Error: ${validation.error}`)
      process.exit(1)
    }
    const previous = getActiveProviderSettings(settings)
    switchHookDetails = {
      fromProvider: previous.active,
      fromModel: previous.model,
      toProvider: currentProvider,
      toModel: value,
      source: 'config',
    }
  }

  // When setting provider, validate that current model is compatible
  if (key === 'provider') {
    const settings = getInitialSettings()
    const currentModel = getActiveProviderSettings(settings).model
    const newProvider = resolveProviderId(value)
    const discovered = newProvider
      ? await ensureProviderModelsFresh(newProvider, { settings, force: true })
      : undefined
    let nextModel = currentModel
    if (currentModel) {
      if (newProvider) {
        const validation = validateProviderModelCompatibility(newProvider, currentModel, {
          availableModels: discovered?.models,
          settings,
        })
        if (validation.valid === false) {
          nextModel = undefined
          const validModelsStr = validation.validModels.join(', ') || '(uses dynamic discovery)'
          const suggestedModel = validation.suggestedModel ?? '<model-name>'
          writeError(`Warning: Current model "${currentModel}" is not available for provider "${newProvider}" and will be cleared.
  Valid models for ${newProvider}: ${validModelsStr}
  After changing provider, run /model or: ur config set model ${suggestedModel}`)
          // Continue with provider change, but warn user
        }
      }
    }
    if (newProvider) {
      const previous = getActiveProviderSettings(settings)
      switchHookDetails = {
        fromProvider: previous.active,
        fromModel: previous.model,
        toProvider: newProvider,
        toModel: nextModel ?? '(unset)',
        source: 'config',
      }
    }
  }

  const isSwitch =
    switchHookDetails !== undefined &&
    (switchHookDetails.fromProvider !== switchHookDetails.toProvider ||
      (switchHookDetails.fromModel ?? '(unset)') !== switchHookDetails.toModel)
  if (switchHookDetails && isSwitch) {
    const preResults = await executePreModelSwitchHooks(switchHookDetails)
    if (hasBlockingResult(preResults)) {
      const reason = preResults
        .filter(result => result.blocked)
        .map(result => result.output.trim())
        .filter(Boolean)
        .join('\n')
      writeError(
        `Provider/model change blocked by PreModelSwitch hook${reason ? `: ${reason}` : '.'}`,
      )
      process.exit(1)
    }
  }

  const result = setSafeProviderConfig(key as ProviderConfigKey, value, {
    ...(targetBaseUrlProvider ? { provider: targetBaseUrlProvider } : {}),
  })
  if (result.ok) {
    if (switchHookDetails && isSwitch) {
      await executePostModelSwitchHooks(switchHookDetails)
    }
    writeOutput(result.message)
    process.exit(0)
  }
  writeError(result.message)
  process.exit(1)
}
