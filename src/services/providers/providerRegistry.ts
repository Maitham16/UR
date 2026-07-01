import { spawn } from 'node:child_process'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { getInitialSettings, updateSettingsForSource } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { which } from '../../utils/which.js'

export const PROVIDER_IDS = [
  'codex-cli',
  'claude-code-cli',
  'gemini-cli',
  'antigravity-cli',
  'openai-api',
  'anthropic-api',
  'gemini-api',
  'openrouter',
  'openai-compatible',
  'ollama',
  'lmstudio',
  'llama.cpp',
  'vllm',
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]
export type ProviderAliasEntry = {
  canonical: ProviderId
  aliases: string[]
}
export type ProviderAccessType = 'subscription' | 'api' | 'local'
export type ProviderAuthMode =
  | 'subscription'
  | 'enterprise-login'
  | 'personal-login'
  | 'api'
  | 'local'

export type ProviderSettings = {
  active?: ProviderId
  model?: string
  baseUrl?: string
  commandPath?: string
  fallback?: ProviderId | 'disabled'
}

export type ProviderDefinition = {
  id: ProviderId
  displayName: string
  statusBarName: string
  accessType: ProviderAccessType
  authMode: ProviderAuthMode
  legalPath: string
  envKey?: string
  commandCandidates?: string[]
  versionArgs?: string[]
  statusArgs?: string[]
  loginArgs?: string[]
  deviceLoginArgs?: string[]
  defaultBaseUrl?: string
  endpointKind?: 'ollama' | 'openai-compatible'
  fallbackAllowed?: boolean
  unsupportedPersonalAccountMessage?: string
}

export type ProviderCheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export type ProviderCheck = {
  name: string
  status: ProviderCheckStatus
  message: string
}

export type ProviderDoctorResult = {
  provider: ProviderId
  displayName: string
  accessType: ProviderAccessType
  authMode: ProviderAuthMode
  selected: boolean
  ok: boolean
  checks: ProviderCheck[]
  failureReason?: string
  suggestedFix?: string
  fallback?: {
    enabled: boolean
    provider?: ProviderId
    message: string
  }
}

export type ProviderRuntimeInfo = {
  provider: ProviderId
  providerLabel: string
  authMode: ProviderAuthMode
  authLabel: string
  model?: string
  baseUrl?: string
  fallback?: ProviderId | 'disabled'
}

export type CommandResult = {
  stdout: string
  stderr: string
  code: number
  error?: string
}

export type ProviderDoctorAdapters = {
  which?: (command: string) => Promise<string | null>
  run?: (file: string, args: string[]) => Promise<CommandResult>
  fetch?: typeof fetch
  env?: Record<string, string | undefined>
}

const LOCALHOST_RE = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/|$)/i

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  'codex-cli': {
    id: 'codex-cli',
    displayName: 'ChatGPT/Codex',
    statusBarName: 'ChatGPT/Codex',
    accessType: 'subscription',
    authMode: 'subscription',
    legalPath: 'official Codex CLI login',
    commandCandidates: ['codex'],
    versionArgs: ['--version'],
    statusArgs: ['login', 'status'],
    loginArgs: ['login'],
    deviceLoginArgs: ['login', '--device-auth'],
  },
  'claude-code-cli': {
    id: 'claude-code-cli',
    displayName: 'Claude Code',
    statusBarName: 'Claude Code',
    accessType: 'subscription',
    authMode: 'subscription',
    legalPath: 'official Claude Code CLI login',
    commandCandidates: ['claude'],
    versionArgs: ['--version'],
    statusArgs: ['auth', 'status'],
    loginArgs: ['auth', 'login'],
  },
  'gemini-cli': {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    statusBarName: 'Gemini CLI',
    accessType: 'subscription',
    authMode: 'enterprise-login',
    legalPath: 'official Gemini Code Assist login',
    commandCandidates: ['gemini'],
    versionArgs: ['--version'],
    loginArgs: [],
    unsupportedPersonalAccountMessage:
      'Personal Google account login is not enabled by UR-AGENT. Use an official Gemini Code Assist Standard/Enterprise path if your Gemini CLI supports it.',
  },
  'antigravity-cli': {
    id: 'antigravity-cli',
    displayName: 'Antigravity',
    statusBarName: 'Antigravity',
    accessType: 'subscription',
    authMode: 'personal-login',
    legalPath: 'official Antigravity CLI login, where supported',
    commandCandidates: ['agy', 'antigravity', 'google-antigravity', 'ag'],
    versionArgs: ['--version'],
    loginArgs: [],
  },
  'openai-api': {
    id: 'openai-api',
    displayName: 'OpenAI API',
    statusBarName: 'OpenAI',
    accessType: 'api',
    authMode: 'api',
    legalPath: 'OPENAI_API_KEY',
    envKey: 'OPENAI_API_KEY',
  },
  'anthropic-api': {
    id: 'anthropic-api',
    displayName: 'Anthropic Claude API',
    statusBarName: 'Anthropic',
    accessType: 'api',
    authMode: 'api',
    legalPath: 'ANTHROPIC_API_KEY',
    envKey: 'ANTHROPIC_API_KEY',
  },
  'gemini-api': {
    id: 'gemini-api',
    displayName: 'Gemini API',
    statusBarName: 'Gemini API',
    accessType: 'api',
    authMode: 'api',
    legalPath: 'GEMINI_API_KEY',
    envKey: 'GEMINI_API_KEY',
  },
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    statusBarName: 'OpenRouter',
    accessType: 'api',
    authMode: 'api',
    legalPath: 'OPENROUTER_API_KEY',
    envKey: 'OPENROUTER_API_KEY',
  },
  'openai-compatible': {
    id: 'openai-compatible',
    displayName: 'OpenAI-compatible',
    statusBarName: 'OpenAI-compatible',
    accessType: 'api',
    authMode: 'api',
    legalPath: 'user-selected OpenAI-compatible base URL with API key only when required by that endpoint',
    envKey: 'OPENAI_API_KEY',
    endpointKind: 'openai-compatible',
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama',
    statusBarName: 'Ollama',
    accessType: 'local',
    authMode: 'local',
    legalPath: 'localhost Ollama runtime',
    defaultBaseUrl: 'http://localhost:11434',
    endpointKind: 'ollama',
  },
  lmstudio: {
    id: 'lmstudio',
    displayName: 'LM Studio',
    statusBarName: 'LM Studio',
    accessType: 'local',
    authMode: 'local',
    legalPath: 'local OpenAI-compatible server',
    defaultBaseUrl: 'http://localhost:1234/v1',
    endpointKind: 'openai-compatible',
  },
  'llama.cpp': {
    id: 'llama.cpp',
    displayName: 'llama.cpp',
    statusBarName: 'llama.cpp',
    accessType: 'local',
    authMode: 'local',
    legalPath: 'local OpenAI-compatible server',
    defaultBaseUrl: 'http://localhost:8080/v1',
    endpointKind: 'openai-compatible',
  },
  vllm: {
    id: 'vllm',
    displayName: 'vLLM',
    statusBarName: 'vLLM',
    accessType: 'local',
    authMode: 'local',
    legalPath: 'OpenAI-compatible server',
    defaultBaseUrl: 'http://localhost:8000/v1',
    endpointKind: 'openai-compatible',
  },
}

const PROVIDER_ALIAS_ENTRIES: ProviderAliasEntry[] = [
  {
    canonical: 'codex-cli',
    aliases: ['chatgpt', 'codex', 'codex cli', 'openai codex', 'chatgpt codex'],
  },
  {
    canonical: 'claude-code-cli',
    aliases: ['claude', 'claude code', 'claude cli', 'anthropic claude'],
  },
  {
    canonical: 'gemini-cli',
    aliases: ['gemini', 'gemini cli', 'gemini code assist', 'google gemini cli'],
  },
  {
    canonical: 'antigravity-cli',
    aliases: ['antigravity', 'antigravity cli', 'agy', 'ag', 'google antigravity'],
  },
  {
    canonical: 'openai-api',
    aliases: ['openai', 'openai api'],
  },
  {
    canonical: 'anthropic-api',
    aliases: ['anthropic', 'anthropic claude api', 'claude api'],
  },
  {
    canonical: 'gemini-api',
    aliases: ['gemini api', 'google gemini api'],
  },
  {
    canonical: 'openrouter',
    aliases: ['openrouter api'],
  },
  {
    canonical: 'openai-compatible',
    aliases: ['compatible', 'openai compatible', 'openai compatible api'],
  },
  {
    canonical: 'ollama',
    aliases: ['ollama local'],
  },
  {
    canonical: 'lmstudio',
    aliases: ['lm studio', 'lm-studio'],
  },
  {
    canonical: 'llama.cpp',
    aliases: ['llama cpp', 'llamacpp', 'llama-cpp'],
  },
  {
    canonical: 'vllm',
    aliases: ['vllm server'],
  },
]

function normalizeProviderInput(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

const PROVIDER_ALIASES: Record<string, ProviderId> = Object.fromEntries(
  PROVIDER_ALIAS_ENTRIES.flatMap(entry => [
    [normalizeProviderInput(entry.canonical), entry.canonical],
    [entry.canonical, entry.canonical],
    ...entry.aliases.map(alias => [normalizeProviderInput(alias), entry.canonical] as const),
  ]),
) as Record<string, ProviderId>

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value)
}

export function resolveProviderId(value: string): ProviderId | null {
  const normalized = normalizeProviderInput(value)
  if (isProviderId(normalized)) {
    return normalized
  }
  return PROVIDER_ALIASES[normalized] ?? null
}

export function providerAliasesFor(id: ProviderId): string[] {
  return PROVIDER_ALIAS_ENTRIES.find(entry => entry.canonical === id)?.aliases ?? []
}

export function getProviderDefinition(id: ProviderId): ProviderDefinition {
  return PROVIDERS[id]
}

export function getActiveProviderSettings(settings: SettingsJson = getInitialSettings()): ProviderSettings {
  const configured = settings.provider ?? {}
  const active = configured.active ? resolveProviderId(configured.active) ?? 'ollama' : 'ollama'
  const fallback =
    configured.fallback === 'disabled'
      ? 'disabled'
      : configured.fallback
        ? resolveProviderId(configured.fallback) ?? undefined
        : undefined
  return {
    active,
    model: configured.model ?? settings.model,
    baseUrl: configured.baseUrl,
    commandPath: configured.commandPath,
    fallback,
  }
}

export function getProviderRuntimeInfo(settings: SettingsJson = getInitialSettings()): ProviderRuntimeInfo {
  const providerSettings = getActiveProviderSettings(settings)
  const provider = providerSettings.active ?? 'ollama'
  const definition = getProviderDefinition(provider)
  return {
    provider,
    providerLabel: definition.statusBarName,
    authMode: definition.authMode,
    authLabel: authModeLabel(definition.authMode),
    model: providerSettings.model,
    baseUrl: providerSettings.baseUrl ?? definition.defaultBaseUrl,
    fallback: providerSettings.fallback,
  }
}

export function authModeLabel(mode: ProviderAuthMode): string {
  switch (mode) {
    case 'subscription':
      return 'subscription'
    case 'enterprise-login':
      return 'enterprise-login'
    case 'personal-login':
      return 'personal-login'
    case 'api':
      return 'API'
    case 'local':
      return 'local'
  }
}

export function listProviders(): ProviderDefinition[] {
  return PROVIDER_IDS.map(id => PROVIDERS[id])
}

function hasSecretLikeValue(value: string): boolean {
  const trimmed = value.trim()
  if (/^(sk-|sk_|sk-proj-|sk-ant-|xox[baprs]-|gh[pousr]_|AIza)/i.test(trimmed)) {
    return true
  }
  if (/token|refresh|oauth|secret|api[_-]?key/i.test(trimmed)) {
    return true
  }
  try {
    const url = new URL(trimmed)
    return Boolean(url.username || url.password)
  } catch {
    return false
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = new URL(withScheme)
  if (url.username || url.password) {
    throw new Error('base_url must not contain embedded credentials')
  }
  return withScheme.replace(/\/$/, '')
}

export function setSafeProviderConfig(
  key:
    | 'provider'
    | 'provider.fallback'
    | 'provider.command_path'
    | 'model'
    | 'base_url',
  value: string,
): { ok: true; message: string } | { ok: false; message: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, message: `Missing value for ${key}.` }
  }
  if (hasSecretLikeValue(trimmed)) {
    return {
      ok: false,
      message:
        'Refusing to store credential-like data. Put API keys in environment variables and select API mode explicitly.',
    }
  }

  let settings: SettingsJson
  try {
    if (key === 'provider') {
      const provider = resolveProviderId(trimmed)
      if (!provider) {
        return {
          ok: false,
          message: `Unknown provider "${trimmed}". Run: ur provider list`,
        }
      }
      settings = { provider: { active: provider } } as SettingsJson
    } else if (key === 'provider.fallback') {
      const fallback = trimmed === 'disabled' ? 'disabled' : resolveProviderId(trimmed)
      if (!fallback) {
        return {
          ok: false,
          message: `Unknown fallback provider "${trimmed}". Run: ur provider list`,
        }
      }
      settings = { provider: { fallback } } as SettingsJson
    } else if (key === 'provider.command_path') {
      settings = { provider: { commandPath: trimmed } } as SettingsJson
    } else if (key === 'model') {
      // Validate model against current provider
      const currentSettings = getInitialSettings()
      const currentProvider = getActiveProviderSettings(currentSettings).active ?? 'ollama'
      const validation = validateProviderModelCompatibility(currentProvider, trimmed)
      if (validation.valid === false) {
        const validModelsStr = validation.validModels.join(', ') || '(uses dynamic discovery)'
        const suggestedModel = validation.suggestedModel ?? 'see provider docs'
        return {
          ok: false,
          message: `${validation.error} Valid models for ${currentProvider}: ${validModelsStr}. Suggested: ${suggestedModel}`,
        }
      }
      settings = { provider: { model: trimmed }, model: trimmed } as SettingsJson
    } else {
      settings = { provider: { baseUrl: normalizeBaseUrl(trimmed) } } as SettingsJson
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  const result = updateSettingsForSource('userSettings', settings)
  if (result.error) {
    return {
      ok: false,
      message: `Failed to write UR-AGENT settings: ${result.error.message}`,
    }
  }
  const savedValue =
    key === 'provider' || key === 'provider.fallback'
      ? key === 'provider.fallback' && trimmed === 'disabled'
        ? 'disabled'
        : resolveProviderId(trimmed) ?? trimmed
      : trimmed
  return { ok: true, message: `Set ${key} to ${savedValue}.` }
}

function outputText(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`.trim()
}

function classifiesAsLoggedIn(text: string): boolean {
  return /logged in|authenticated|signed in|active account|using chatgpt/i.test(text)
}

function classifiesAsNotLoggedIn(text: string): boolean {
  return /not logged in|not authenticated|not signed in|login required|unauthenticated/i.test(text)
}

export function classifyGeminiAccountSupport(text: string):
  | 'enterprise-supported'
  | 'personal-unsupported'
  | 'unknown' {
  if (/personal.*unsupported|unsupported.*personal|consumer.*unsupported/i.test(text)) {
    return 'personal-unsupported'
  }
  if (/enterprise|standard|code assist|workspace/i.test(text)) {
    return 'enterprise-supported'
  }
  return 'unknown'
}

async function resolveCommand(
  definition: ProviderDefinition,
  settings: ProviderSettings,
  adapters: ProviderDoctorAdapters,
): Promise<string | null> {
  if (settings.commandPath) {
    return settings.commandPath
  }
  for (const candidate of definition.commandCandidates ?? []) {
    const found = await (adapters.which ?? which)(candidate)
    if (found) return found
  }
  return null
}

async function runCommand(
  file: string,
  args: string[],
  adapters: ProviderDoctorAdapters,
): Promise<CommandResult> {
  if (adapters.run) {
    return adapters.run(file, args)
  }
  return execFileNoThrow(file, args, {
    timeout: 15_000,
    preserveOutputOnError: true,
    audit: false,
  })
}

function addFailure(result: ProviderDoctorResult, reason: string, fix: string): void {
  result.ok = false
  result.failureReason ??= reason
  result.suggestedFix ??= fix
}

function endpointUrl(baseUrl: string, kind: 'ollama' | 'openai-compatible'): string {
  const trimmed = baseUrl.replace(/\/$/, '')
  if (kind === 'ollama') {
    return `${trimmed}/api/tags`
  }
  return `${trimmed}/models`
}

function isLocalBaseUrl(value: string): boolean {
  return LOCALHOST_RE.test(value)
}

async function checkEndpoint(
  definition: ProviderDefinition,
  settings: ProviderSettings,
  adapters: ProviderDoctorAdapters,
  result: ProviderDoctorResult,
): Promise<void> {
  if (!definition.endpointKind) return
  const baseUrl = settings.baseUrl ?? definition.defaultBaseUrl
  if (!baseUrl) {
    result.checks.push({
      name: 'base_url',
      status: 'fail',
      message: 'No base_url configured.',
    })
    addFailure(result, 'missing base_url', 'Run: ur config set base_url <url>')
    return
  }
  const url = endpointUrl(baseUrl, definition.endpointKind)
  try {
    const response = await (adapters.fetch ?? fetch)(url, {
      method: 'GET',
      headers:
        definition.accessType === 'api' && (adapters.env ?? process.env)[definition.envKey ?? '']
          ? { Authorization: `Bearer ${(adapters.env ?? process.env)[definition.envKey ?? '']}` }
          : undefined,
    })
    if (!response.ok) {
      result.checks.push({
        name: 'endpoint',
        status: 'fail',
        message: `${url} returned HTTP ${response.status}.`,
      })
      addFailure(
        result,
        `endpoint returned HTTP ${response.status}`,
        `Start the provider server or update base_url: ur config set base_url ${baseUrl}`,
      )
      return
    }
    result.checks.push({
      name: 'endpoint',
      status: 'pass',
      message: `${url} is reachable.`,
    })
    if (settings.model) {
      const body = await response.text().catch(() => '')
      if (body && !body.includes(settings.model)) {
        result.checks.push({
          name: 'model',
          status: 'warn',
          message: `Model "${settings.model}" was not found in the detectable model list.`,
        })
      } else {
        result.checks.push({
          name: 'model',
          status: 'pass',
          message: `Model "${settings.model}" is detectable.`,
        })
      }
    }
  } catch (error) {
    result.checks.push({
      name: 'endpoint',
      status: 'fail',
      message: `${url} is not reachable.`,
    })
    addFailure(
      result,
      error instanceof Error ? error.message : 'endpoint unavailable',
      `Start the provider server or update base_url: ur config set base_url ${baseUrl}`,
    )
  }
}

async function checkSubscriptionProvider(
  definition: ProviderDefinition,
  settings: ProviderSettings,
  adapters: ProviderDoctorAdapters,
  result: ProviderDoctorResult,
): Promise<void> {
  const commandPath = await resolveCommand(definition, settings, adapters)
  if (!commandPath) {
    const commands = definition.commandCandidates?.join(', ') ?? definition.id
    result.checks.push({
      name: 'cli',
      status: 'fail',
      message: `No official CLI command found on PATH. Tried: ${commands}.`,
    })
    addFailure(result, 'CLI missing', `Install the official ${definition.displayName} CLI, then run ur auth ${authAliasForProvider(definition.id)}.`)
    return
  }

  result.checks.push({
    name: 'cli',
    status: 'pass',
    message: `${commandPath} found.`,
  })

  if (definition.versionArgs) {
    const version = await runCommand(commandPath, definition.versionArgs, adapters)
    result.checks.push({
      name: 'version',
      status: version.code === 0 ? 'pass' : 'warn',
      message: outputText(version) || `${definition.displayName} version check exited ${version.code}.`,
    })
  }

  if (definition.id === 'claude-code-cli' && (adapters.env ?? process.env).ANTHROPIC_API_KEY) {
    result.checks.push({
      name: 'api_key_override',
      status: 'warn',
      message:
        'ANTHROPIC_API_KEY is set and may override Claude Code subscription login. Unset it to test subscription auth.',
    })
  }

  if (definition.id === 'gemini-cli') {
    const versionText = result.checks.find(check => check.name === 'version')?.message ?? ''
    const support = classifyGeminiAccountSupport(versionText)
    if (support === 'personal-unsupported') {
      result.checks.push({
        name: 'account_type',
        status: 'fail',
        message: definition.unsupportedPersonalAccountMessage ?? 'Unsupported account type.',
      })
      addFailure(result, 'unsupported account type', 'Use an official Gemini Code Assist Standard/Enterprise login path.')
    } else if (support === 'enterprise-supported') {
      result.checks.push({
        name: 'account_type',
        status: 'pass',
        message: 'Gemini Code Assist Standard/Enterprise path is supported by the detected CLI output.',
      })
    } else {
      result.checks.push({
        name: 'account_type',
        status: 'warn',
        message:
          'Gemini CLI status is not exposed by this CLI. UR-AGENT will only use the official Gemini CLI flow and will not support personal-account bypasses.',
      })
    }
  }

  if (!definition.statusArgs) {
    result.checks.push({
      name: 'login_status',
      status: 'skip',
      message: 'No stable official status command is configured for this provider.',
    })
    return
  }

  const status = await runCommand(commandPath, definition.statusArgs, adapters)
  const text = outputText(status)
  if (status.code === 0 && !classifiesAsNotLoggedIn(text)) {
    result.checks.push({
      name: 'login_status',
      status: classifiesAsLoggedIn(text) ? 'pass' : 'warn',
      message: text || 'Status command succeeded.',
    })
    return
  }

  result.checks.push({
    name: 'login_status',
    status: 'fail',
    message: text || `${definition.displayName} is not logged in.`,
  })
  addFailure(result, 'not logged in', `Run: ur auth ${authAliasForProvider(definition.id)}`)
}

async function checkApiProvider(
  definition: ProviderDefinition,
  settings: ProviderSettings,
  adapters: ProviderDoctorAdapters,
  result: ProviderDoctorResult,
): Promise<void> {
  const env = adapters.env ?? process.env
  const baseUrl = settings.baseUrl ?? definition.defaultBaseUrl
  const requiresKey =
    definition.id !== 'openai-compatible' ||
    !baseUrl ||
    !isLocalBaseUrl(baseUrl)
  if (definition.envKey && requiresKey) {
    if (env[definition.envKey]) {
      result.checks.push({
        name: 'api_key',
        status: 'pass',
        message: `${definition.envKey} is present.`,
      })
    } else {
      result.checks.push({
        name: 'api_key',
        status: 'fail',
        message: `${definition.envKey} is not set.`,
      })
      addFailure(result, 'API key missing', `Set ${definition.envKey} in your environment or choose a subscription/local provider.`)
    }
  }
  await checkEndpoint(definition, settings, adapters, result)
}

function fallbackResult(
  settings: ProviderSettings,
  active: ProviderId,
  ok: boolean,
): ProviderDoctorResult['fallback'] {
  if (ok) return undefined
  if (!settings.fallback || settings.fallback === 'disabled') {
    return {
      enabled: false,
      message:
        'Fallback is disabled. UR-AGENT will not silently switch providers. Optional: ur config set provider.fallback ollama',
    }
  }
  if (settings.fallback === active) {
    return {
      enabled: false,
      message: 'Fallback points at the selected provider and will not be used.',
    }
  }
  return {
    enabled: true,
    provider: settings.fallback,
    message: `Fallback is configured as ${settings.fallback}, but UR-AGENT will ask before using it.`,
  }
}

export async function doctorProvider(
  provider: ProviderId | undefined,
  options: {
    settings?: SettingsJson
    adapters?: ProviderDoctorAdapters
  } = {},
): Promise<ProviderDoctorResult> {
  const allSettings = options.settings ?? getInitialSettings()
  const providerSettings = getActiveProviderSettings(allSettings)
  const active = provider ?? providerSettings.active ?? 'ollama'
  const definition = getProviderDefinition(active)
  const settingsForProvider: ProviderSettings = {
    ...providerSettings,
    active,
  }
  const result: ProviderDoctorResult = {
    provider: active,
    displayName: definition.displayName,
    accessType: definition.accessType,
    authMode: definition.authMode,
    selected: active === providerSettings.active,
    ok: true,
    checks: [
      {
        name: 'legal_path',
        status: 'pass',
        message: definition.legalPath,
      },
    ],
  }

  if (definition.accessType === 'subscription') {
    await checkSubscriptionProvider(definition, settingsForProvider, options.adapters ?? {}, result)
  } else if (definition.accessType === 'api') {
    await checkApiProvider(definition, settingsForProvider, options.adapters ?? {}, result)
  } else {
    await checkEndpoint(definition, settingsForProvider, options.adapters ?? {}, result)
  }

  result.fallback = fallbackResult(providerSettings, active, result.ok)
  return result
}

export async function doctorActiveProvider(options: {
  settings?: SettingsJson
  adapters?: ProviderDoctorAdapters
} = {}): Promise<ProviderDoctorResult> {
  const settings = options.settings ?? getInitialSettings()
  const active = getActiveProviderSettings(settings).active ?? 'ollama'
  return doctorProvider(active, options)
}

export function authAliasForProvider(provider: ProviderId): 'chatgpt' | 'claude' | 'gemini' | 'antigravity' | 'provider' {
  switch (provider) {
    case 'codex-cli':
      return 'chatgpt'
    case 'claude-code-cli':
      return 'claude'
    case 'gemini-cli':
      return 'gemini'
    case 'antigravity-cli':
      return 'antigravity'
    default:
      return 'provider'
  }
}

export function providerForAuthAlias(alias: string): ProviderId | null {
  switch (alias) {
    case 'chatgpt':
      return 'codex-cli'
    case 'claude':
      return 'claude-code-cli'
    case 'gemini':
      return 'gemini-cli'
    case 'antigravity':
      return 'antigravity-cli'
    default:
      return null
  }
}

export function buildProviderAuthCommand(
  provider: ProviderId,
  options: { deviceAuth?: boolean } = {},
): { command: string; args: string[]; instructions: string } | null {
  const definition = getProviderDefinition(provider)
  const command = definition.commandCandidates?.[0]
  if (!command) return null
  const args =
    options.deviceAuth && definition.deviceLoginArgs
      ? definition.deviceLoginArgs
      : definition.loginArgs
  if (!args) return null

  if (provider === 'gemini-cli') {
    return {
      command,
      args,
      instructions:
        'The detected Gemini CLI does not expose a stable non-interactive login subcommand. Launching the official Gemini CLI is the only supported path; complete the Gemini Code Assist login flow if prompted.',
    }
  }
  if (provider === 'antigravity-cli') {
    return {
      command,
      args,
      instructions:
        'UR-AGENT will only launch the official Antigravity CLI. Use its documented login flow where supported; UR-AGENT will not invent flags or reuse browser sessions.',
    }
  }
  return {
    command,
    args,
    instructions: `Launching ${definition.legalPath}.`,
  }
}

export async function launchProviderAuth(
  alias: 'chatgpt' | 'claude' | 'gemini' | 'antigravity',
  options: { deviceAuth?: boolean; dryRun?: boolean } = {},
): Promise<{ ok: boolean; message: string; command?: string }> {
  const provider = providerForAuthAlias(alias)
  if (!provider) {
    return { ok: false, message: `Unknown auth provider "${alias}".` }
  }
  const authCommand = buildProviderAuthCommand(provider, options)
  if (!authCommand) {
    return {
      ok: false,
      message: `No official login command is configured for ${provider}.`,
    }
  }
  const commandPath = await resolveCommand(getProviderDefinition(provider), {}, {})
  if (!commandPath) {
    const commands = getProviderDefinition(provider).commandCandidates?.join(', ') ?? provider
    return {
      ok: false,
      message: `No official ${getProviderDefinition(provider).displayName} CLI command found. Tried: ${commands}. Install the official CLI first.`,
    }
  }
  const printableCommand = commandPath.split(/[\\/]/).pop() ?? authCommand.command
  const printable = [printableCommand, ...authCommand.args].join(' ')
  if (options.dryRun || !process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      ok: true,
      message: `${authCommand.instructions}\nRun: ${printable}`,
      command: printable,
    }
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(commandPath, authCommand.args, {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${printable} exited with code ${code ?? 1}`))
    })
  })
  return { ok: true, message: `Completed: ${printable}`, command: printable }
}

export function formatProviderList(json = false): string {
  const providers = listProviders().map(provider => ({
    id: provider.id,
    name: provider.displayName,
    aliases: providerAliasesFor(provider.id),
    accessType: provider.accessType,
    authMode: provider.authMode,
    legalPath: provider.legalPath,
  }))
  if (json) {
    return JSON.stringify(providers, null, 2)
  }
  return [
    'Provider | ID | Aliases | Access type | Legal path',
    '--- | --- | --- | --- | ---',
    ...providers.map(provider =>
      `${provider.name} | ${provider.id} | ${provider.aliases.slice(0, 3).join(', ') || '-'} | ${provider.accessType} | ${provider.legalPath}`,
    ),
  ].join('\n')
}

export function formatProviderDoctor(result: ProviderDoctorResult, json = false): string {
  if (json) {
    return JSON.stringify(result, null, 2)
  }
  const lines = [
    `Provider: ${result.displayName} (${result.provider})`,
    `Auth: ${authModeLabel(result.authMode)}`,
    `Status: ${result.ok ? 'ready' : 'not ready'}`,
  ]
  for (const check of result.checks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.name}: ${check.message}`)
  }
  if (result.failureReason) {
    lines.push(`Failure reason: ${result.failureReason}`)
  }
  if (result.suggestedFix) {
    lines.push(`Suggested fix: ${result.suggestedFix}`)
  }
  if (result.fallback) {
    lines.push(`Fallback: ${result.fallback.message}`)
  }
  return lines.join('\n')
}

export function formatProviderStatus(result: ProviderDoctorResult, json = false): string {
  if (json) {
    return JSON.stringify(result, null, 2)
  }
  const failure = result.failureReason ? `\nFailure reason: ${result.failureReason}` : ''
  const fix = result.suggestedFix ? `\nSuggested fix: ${result.suggestedFix}` : ''
  return `Selected provider: ${result.displayName} (${result.provider})\nAuth mode: ${authModeLabel(result.authMode)}\nReady: ${result.ok ? 'yes' : 'no'}${failure}${fix}`
}

// Provider-specific model definitions
// Each provider has its own set of models. This is the single source of truth.
export type ProviderModelDefinition = {
  id: string
  displayName: string
  description: string
  isDefault?: boolean
  isDynamic?: boolean  // For providers that support live model discovery
}

export const PROVIDER_MODELS: Record<ProviderId, ProviderModelDefinition[]> = {
  'codex-cli': [
    { id: 'gpt-4o', displayName: 'GPT-4o', description: 'Most capable GPT-4 model' },
    { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', description: 'Fast and efficient GPT-4o variant' },
    { id: 'o1', displayName: 'o1', description: 'Reasoning model for complex tasks' },
    { id: 'o3-mini', displayName: 'o3-mini', description: 'Fast reasoning model' },
  ],
  'claude-code-cli': [
    { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', description: 'Most balanced Claude model', isDefault: true },
    { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4', description: 'Most powerful Claude model' },
    { id: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', description: 'Previous generation Sonnet' },
  ],
  'gemini-cli': [
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', description: 'Fast Gemini model', isDefault: true },
    { id: 'gemini-2.0-pro', displayName: 'Gemini 2.0 Pro', description: 'Most capable Gemini model' },
  ],
  'antigravity-cli': [
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', description: 'Fast Gemini model', isDefault: true },
  ],
  'openai-api': [
    { id: 'gpt-4o', displayName: 'GPT-4o', description: 'Most capable GPT-4 model', isDefault: true },
    { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', description: 'Fast and efficient GPT-4o variant' },
    { id: 'o1', displayName: 'o1', description: 'Reasoning model for complex tasks' },
    { id: 'o3-mini', displayName: 'o3-mini', description: 'Fast reasoning model' },
    { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', description: 'Previous generation GPT-4' },
  ],
  'anthropic-api': [
    { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', description: 'Most balanced Claude model', isDefault: true },
    { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4', description: 'Most powerful Claude model' },
    { id: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', description: 'Previous generation Sonnet' },
    { id: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku', description: 'Fastest Claude model' },
  ],
  'gemini-api': [
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', description: 'Fast Gemini model', isDefault: true },
    { id: 'gemini-2.0-pro', displayName: 'Gemini 2.0 Pro', description: 'Most capable Gemini model' },
    { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', description: 'Previous generation Flash' },
  ],
  'openrouter': [
    { id: 'openai/gpt-4o', displayName: 'GPT-4o', description: 'OpenAI GPT-4o via OpenRouter' },
    { id: 'anthropic/claude-3.5-sonnet', displayName: 'Claude 3.5 Sonnet', description: 'Anthropic Claude via OpenRouter' },
    { id: 'google/gemini-pro-1.5', displayName: 'Gemini Pro 1.5', description: 'Google Gemini via OpenRouter' },
  ],
  'openai-compatible': [
    { id: 'custom', displayName: 'Custom Model', description: 'Model name from provider endpoint', isDynamic: true },
  ],
  'ollama': [
    { id: 'dynamic', displayName: 'Discovered Models', description: 'Models discovered from Ollama server', isDynamic: true, isDefault: true },
  ],
  'lmstudio': [
    { id: 'dynamic', displayName: 'Discovered Models', description: 'Models discovered from LM Studio server', isDynamic: true, isDefault: true },
  ],
  'llama.cpp': [
    { id: 'dynamic', displayName: 'Discovered Models', description: 'Models discovered from llama.cpp server', isDynamic: true, isDefault: true },
  ],
  'vllm': [
    { id: 'dynamic', displayName: 'Discovered Models', description: 'Models discovered from vLLM server', isDynamic: true, isDefault: true },
  ],
}

/**
 * List all models available for a specific provider.
 * For providers with dynamic discovery, this returns a placeholder that triggers live discovery.
 */
export function listModelsForProvider(providerId: ProviderId | string): ProviderModelDefinition[] {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return []
  }
  return PROVIDER_MODELS[provider] ?? []
}

/**
 * Check if a model is supported by a specific provider.
 */
export function isModelSupportedByProvider(
  providerId: ProviderId | string,
  modelId: string,
): boolean {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return false
  }
  const models = PROVIDER_MODELS[provider]
  if (!models) {
    return false
  }
  // For dynamic providers, any model name is valid (will be discovered at runtime)
  const hasDynamic = models.some(m => m.isDynamic)
  if (hasDynamic) {
    return true
  }
  return models.some(m => m.id === modelId)
}

/**
 * Get the default model for a provider.
 */
export function getDefaultModelForProvider(providerId: ProviderId | string): string | undefined {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return undefined
  }
  const models = PROVIDER_MODELS[provider]
  if (!models) {
    return undefined
  }
  const defaultModel = models.find(m => m.isDefault)
  return defaultModel?.id
}

/**
 * Get valid model IDs for a provider (for error messages and validation).
 */
export function getValidModelIdsForProvider(providerId: ProviderId | string): string[] {
  const models = listModelsForProvider(providerId)
  return models.filter(m => !m.isDynamic).map(m => m.id)
}

/**
 * Validate that a provider-model pair is compatible.
 * Returns an error message if invalid, or null if valid.
 */
export function validateProviderModelCompatibility(
  providerId: ProviderId | string,
  modelId: string,
): { valid: true } | { valid: false; error: string; validModels: string[]; suggestedModel?: string } {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return {
      valid: false,
      error: `Unknown provider "${providerId}". Run: ur provider list`,
      validModels: [],
    }
  }

  const models = PROVIDER_MODELS[provider]
  if (!models) {
    return {
      valid: false,
      error: `No models defined for provider "${provider}".`,
      validModels: [],
    }
  }

  // Check if this is a dynamic provider (discovers models at runtime)
  const hasDynamic = models.some(m => m.isDynamic)
  if (hasDynamic) {
    // Dynamic providers accept any model name
    return { valid: true }
  }

  // Check if the model is in the provider's model list
  const modelExists = models.some(m => m.id === modelId)
  if (modelExists) {
    return { valid: true }
  }

  // Model not found - build helpful error message
  const validModelIds = getValidModelIdsForProvider(provider)
  const defaultModel = getDefaultModelForProvider(provider)

  return {
    valid: false,
    error: `Model "${modelId}" is not available for provider "${provider}".`,
    validModels: validModelIds,
    suggestedModel: defaultModel,
  }
}
