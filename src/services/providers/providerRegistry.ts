import { spawn } from 'node:child_process'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { getOllamaBaseUrl } from '../../utils/model/ollamaConfig.js'
import { getInitialSettings, updateSettingsForSource } from '../../utils/settings/settings.js'
import type { EditableSettingSource } from '../../utils/settings/constants.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { which } from '../../utils/which.js'

export const PROVIDER_IDS = [
  'ollama',
  'subscription',
  'lmstudio',
  'llama.cpp',
  'vllm',
  'openai-compatible',
  'openai-api',
  'anthropic-api',
  'gemini-api',
  'openrouter',
  'codex-cli',
  'claude-code-cli',
  'gemini-cli',
  'antigravity-cli',
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

// Single default used when no provider is configured (first run). This is the
// only place the Ollama default is hardcoded; every other site derives from it.
export const DEFAULT_PROVIDER_ID: ProviderId = 'ollama'

// Wire/runtime family a provider belongs to. Drives request shaping in the API
// adapters and exposes real provider identity to the rest of the runtime.
export type ProviderFamily =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openai-compatible'
  | 'subscription'
  | 'ollama'

export type ProviderAliasEntry = {
  canonical: ProviderId
  aliases: string[]
}
export type ProviderAccessType = 'subscription' | 'api' | 'local' | 'server'
export type ProviderCredentialType =
  | 'subscription-login'
  | 'cli-login'
  | 'api-key'
  | 'local-runtime'
  | 'openai-compatible-endpoint'
export type ProviderModelDiscoveryType = 'static' | 'live'
export type ProviderStatusCheckType = 'subscription-login' | 'cli-login' | 'api-key' | 'endpoint'
export type ProviderModelListType = 'static' | 'ollama-tags' | 'openai-compatible-models'
export type ProviderModelValidationType = 'static-list' | 'discovered-list'
export type ProviderRuntimeKind = 'ur-native' | 'external-app'
export type ProviderKind = 'ur-native' | 'subscription-cli' | 'subscription-placeholder'
export type ProviderSafetyBoundary =
  | 'ur-native-runtime'
  | 'external-subscription-cli'
  | 'unconfigured-subscription'
export type ProviderAuthMode =
  | 'subscription'
  | 'enterprise-login'
  | 'personal-login'
  | 'api'
  | 'local'

export type ProviderCapabilities = {
  providerKind: ProviderKind
  usesExternalCli: boolean
  supportsNativeToolCalls: boolean
  supportsNativeStreaming: boolean
  safetyBoundary: ProviderSafetyBoundary
  safetyBoundaryLabel: string
}

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
  accessTypeLabel?: string
  credentialType: ProviderCredentialType
  modelDiscoveryType: ProviderModelDiscoveryType
  statusCheck: ProviderStatusCheckType
  listModels: ProviderModelListType
  validateModel: ProviderModelValidationType
  runtimeKind: ProviderRuntimeKind
  providerKind: ProviderKind
  usesExternalCli: boolean
  supportsNativeToolCalls: boolean
  supportsNativeStreaming: boolean
  safetyBoundary: ProviderSafetyBoundary
  safetyBoundaryLabel: string
  authMode: ProviderAuthMode
  legalPath: string
  accessPathLabel: string
  envKey?: string
  commandCandidates?: string[]
  versionArgs?: string[]
  statusArgs?: string[]
  loginArgs?: string[]
  deviceLoginArgs?: string[]
  defaultBaseUrl?: string
  endpointKind?: 'ollama' | 'openai-compatible'
  unsupportedPersonalAccountMessage?: string
  disabled?: boolean
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
  providerKind: ProviderKind
  usesExternalCli: boolean
  supportsNativeToolCalls: boolean
  supportsNativeStreaming: boolean
  safetyBoundary: ProviderSafetyBoundary
  safetyBoundaryLabel: string
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
  accessType: ProviderAccessType
  accessTypeLabel: string
  credentialType: ProviderCredentialType
  providerKind: ProviderKind
  usesExternalCli: boolean
  supportsNativeToolCalls: boolean
  supportsNativeStreaming: boolean
  safetyBoundary: ProviderSafetyBoundary
  safetyBoundaryLabel: string
  runtimeBackend: string
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
  /** Minimal fetch-like signature: `typeof fetch` would also demand the
   *  `preconnect` static (undici), which test stubs can't provide and the
   *  doctor never calls. */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  env?: Record<string, string | undefined>
}

export type ProviderConnectionStatus = 'connected' | 'missing' | 'unavailable' | 'unknown'

export type ProviderStatusSummary = {
  provider: ProviderId
  displayName: string
  accessType: ProviderAccessType
  accessTypeLabel: string
  credentialType: ProviderCredentialType
  providerKind: ProviderKind
  usesExternalCli: boolean
  supportsNativeToolCalls: boolean
  supportsNativeStreaming: boolean
  safetyBoundary: ProviderSafetyBoundary
  safetyBoundaryLabel: string
  status: ProviderConnectionStatus
  label: string
  checks: ProviderCheck[]
  doctor: ProviderDoctorResult
}

export type ProviderModelSource = 'live' | 'cache' | 'static'

export type ProviderModelDiscoveryResult = {
  provider: ProviderId
  models: ProviderModelDefinition[]
  source: ProviderModelSource
  warning?: string
}

const LOCALHOST_RE = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/|$)/i

export const UR_NATIVE_PROVIDER_BOUNDARY =
  'UR-native runtime: UR owns provider request shaping, native tool-call parsing, native streaming, and UR-run tool permission/sandbox/verifier flow.'

export const SUBSCRIPTION_CLI_PROVIDER_BOUNDARY =
  'External vendor CLI boundary: UR passes prompt text to the official CLI and receives final text output. UR-native tool calling, UR Bash/File tool execution, UR-native streaming, local command permissions, sandbox guarantees, and verifier/done-gate checks apply to UR-run tools/final UR output, not to actions the external CLI performs internally.'

export const UNCONFIGURED_SUBSCRIPTION_PROVIDER_BOUNDARY =
  'Unconfigured subscription placeholder: no runtime is attached. Choose a specific subscription CLI, API, local, or server provider.'

const UR_NATIVE_CAPABILITIES: ProviderCapabilities = {
  providerKind: 'ur-native',
  usesExternalCli: false,
  supportsNativeToolCalls: true,
  supportsNativeStreaming: true,
  safetyBoundary: 'ur-native-runtime',
  safetyBoundaryLabel: UR_NATIVE_PROVIDER_BOUNDARY,
}

const SUBSCRIPTION_CLI_CAPABILITIES: ProviderCapabilities = {
  providerKind: 'subscription-cli',
  usesExternalCli: true,
  supportsNativeToolCalls: false,
  supportsNativeStreaming: false,
  safetyBoundary: 'external-subscription-cli',
  safetyBoundaryLabel: SUBSCRIPTION_CLI_PROVIDER_BOUNDARY,
}

const SUBSCRIPTION_PLACEHOLDER_CAPABILITIES: ProviderCapabilities = {
  providerKind: 'subscription-placeholder',
  usesExternalCli: false,
  supportsNativeToolCalls: false,
  supportsNativeStreaming: false,
  safetyBoundary: 'unconfigured-subscription',
  safetyBoundaryLabel: UNCONFIGURED_SUBSCRIPTION_PROVIDER_BOUNDARY,
}

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  subscription: {
    id: 'subscription',
    displayName: 'Subscription',
    statusBarName: 'Subscription',
    accessType: 'subscription',
    credentialType: 'subscription-login',
    modelDiscoveryType: 'static',
    statusCheck: 'subscription-login',
    listModels: 'static',
    validateModel: 'static-list',
    runtimeKind: 'ur-native',
    ...SUBSCRIPTION_PLACEHOLDER_CAPABILITIES,
    authMode: 'subscription',
    legalPath: 'independent subscription runtime only',
    accessPathLabel: 'subscription login; no external provider app bridge',
  },
  'codex-cli': {
    id: 'codex-cli',
    displayName: 'Codex CLI',
    statusBarName: 'Codex CLI',
    accessType: 'subscription',
    credentialType: 'cli-login',
    modelDiscoveryType: 'static',
    statusCheck: 'cli-login',
    listModels: 'static',
    validateModel: 'static-list',
    runtimeKind: 'external-app',
    ...SUBSCRIPTION_CLI_CAPABILITIES,
    authMode: 'subscription',
    legalPath: 'official Codex CLI login',
    accessPathLabel: 'subscription login via official Codex CLI',
    commandCandidates: ['codex'],
    versionArgs: ['--version'],
    statusArgs: ['login', 'status'],
    loginArgs: ['login'],
    deviceLoginArgs: ['login', '--device-auth'],
    disabled: true,
  },
  'claude-code-cli': {
    id: 'claude-code-cli',
    displayName: 'Claude Code',
    statusBarName: 'Claude Code',
    accessType: 'subscription',
    credentialType: 'cli-login',
    modelDiscoveryType: 'static',
    statusCheck: 'cli-login',
    listModels: 'static',
    validateModel: 'static-list',
    runtimeKind: 'external-app',
    ...SUBSCRIPTION_CLI_CAPABILITIES,
    authMode: 'subscription',
    legalPath: 'official Claude Code CLI login',
    accessPathLabel: 'subscription login via official Claude Code CLI',
    commandCandidates: ['claude'],
    versionArgs: ['--version'],
    statusArgs: ['auth', 'status'],
    loginArgs: ['auth', 'login'],
    disabled: true,
  },
  'gemini-cli': {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    statusBarName: 'Gemini CLI',
    accessType: 'subscription',
    credentialType: 'cli-login',
    modelDiscoveryType: 'static',
    statusCheck: 'cli-login',
    listModels: 'static',
    validateModel: 'static-list',
    runtimeKind: 'external-app',
    ...SUBSCRIPTION_CLI_CAPABILITIES,
    authMode: 'enterprise-login',
    legalPath: 'official Gemini Code Assist login',
    accessPathLabel: 'subscription login via official Gemini CLI',
    commandCandidates: ['gemini'],
    versionArgs: ['--version'],
    loginArgs: [],
    unsupportedPersonalAccountMessage:
      'Personal Google account login is not enabled by UR-Nexus. Use an official Gemini Code Assist Standard/Enterprise path if your Gemini CLI supports it.',
    disabled: true,
    },
  'antigravity-cli': {
    id: 'antigravity-cli',
    displayName: 'Antigravity',
    statusBarName: 'Antigravity',
    accessType: 'subscription',
    credentialType: 'cli-login',
    modelDiscoveryType: 'static',
    statusCheck: 'cli-login',
    listModels: 'static',
    validateModel: 'static-list',
    runtimeKind: 'external-app',
    ...SUBSCRIPTION_CLI_CAPABILITIES,
    authMode: 'personal-login',
    legalPath: 'official Antigravity CLI login, where supported',
    accessPathLabel: 'subscription login via official Antigravity CLI',
    commandCandidates: ['agy', 'antigravity', 'google-antigravity', 'ag'],
    versionArgs: ['--version'],
    loginArgs: [],
    disabled: true,
  },
  'openai-api': {
    id: 'openai-api',
    displayName: 'OpenAI API',
    statusBarName: 'OpenAI',
    accessType: 'api',
    credentialType: 'api-key',
    modelDiscoveryType: 'live',
    statusCheck: 'api-key',
    listModels: 'static',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'api',
    legalPath: 'OPENAI_API_KEY',
    accessPathLabel: 'API key from OPENAI_API_KEY',
    envKey: 'OPENAI_API_KEY',
  },
  'anthropic-api': {
    id: 'anthropic-api',
    displayName: 'Claude API',
    statusBarName: 'Claude API',
    accessType: 'api',
    credentialType: 'api-key',
    modelDiscoveryType: 'live',
    statusCheck: 'api-key',
    listModels: 'static',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'api',
    legalPath: 'ANTHROPIC_API_KEY',
    accessPathLabel: 'API key from ANTHROPIC_API_KEY',
    envKey: 'ANTHROPIC_API_KEY',
  },
  'gemini-api': {
    id: 'gemini-api',
    displayName: 'Gemini API',
    statusBarName: 'Gemini API',
    accessType: 'api',
    credentialType: 'api-key',
    modelDiscoveryType: 'live',
    statusCheck: 'api-key',
    listModels: 'static',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'api',
    legalPath: 'GEMINI_API_KEY',
    accessPathLabel: 'API key from GEMINI_API_KEY',
    envKey: 'GEMINI_API_KEY',
  },
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    statusBarName: 'OpenRouter',
    accessType: 'api',
    credentialType: 'api-key',
    modelDiscoveryType: 'live',
    statusCheck: 'api-key',
    listModels: 'static',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'api',
    legalPath: 'OPENROUTER_API_KEY',
    accessPathLabel: 'API key from OPENROUTER_API_KEY',
    envKey: 'OPENROUTER_API_KEY',
  },
  'openai-compatible': {
    id: 'openai-compatible',
    displayName: 'OpenAI-compatible',
    statusBarName: 'OpenAI-compatible',
    accessType: 'api',
    accessTypeLabel: 'server/api',
    credentialType: 'openai-compatible-endpoint',
    modelDiscoveryType: 'live',
    statusCheck: 'endpoint',
    listModels: 'openai-compatible-models',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'api',
    legalPath: 'user-selected OpenAI-compatible base URL with API key only when required by that endpoint',
    accessPathLabel: 'OpenAI-compatible endpoint',
    envKey: 'OPENAI_COMPATIBLE_API_KEY',
    endpointKind: 'openai-compatible',
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama',
    statusBarName: 'Ollama',
    accessType: 'local',
    credentialType: 'local-runtime',
    modelDiscoveryType: 'live',
    statusCheck: 'endpoint',
    listModels: 'ollama-tags',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'local',
    legalPath: 'localhost Ollama runtime',
    accessPathLabel: 'local Ollama runtime',
    defaultBaseUrl: 'http://localhost:11434',
    endpointKind: 'ollama',
  },
  lmstudio: {
    id: 'lmstudio',
    displayName: 'LM Studio',
    statusBarName: 'LM Studio',
    accessType: 'server',
    accessTypeLabel: 'local/server',
    credentialType: 'openai-compatible-endpoint',
    modelDiscoveryType: 'live',
    statusCheck: 'endpoint',
    listModels: 'openai-compatible-models',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...SUBSCRIPTION_CLI_CAPABILITIES,
    authMode: 'local',
    legalPath: 'local OpenAI-compatible server',
    accessPathLabel: 'local OpenAI-compatible endpoint',
    defaultBaseUrl: 'http://localhost:1234/v1',
    disabled: true,
    endpointKind: 'openai-compatible',
  },
  'llama.cpp': {
    id: 'llama.cpp',
    displayName: 'llama.cpp',
    statusBarName: 'llama.cpp',
    accessType: 'server',
    accessTypeLabel: 'local/server',
    credentialType: 'openai-compatible-endpoint',
    modelDiscoveryType: 'live',
    statusCheck: 'endpoint',
    listModels: 'openai-compatible-models',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'local',
    legalPath: 'local OpenAI-compatible server',
    accessPathLabel: 'local OpenAI-compatible endpoint',
    defaultBaseUrl: 'http://localhost:8080/v1',
    endpointKind: 'openai-compatible',
  },
  vllm: {
    id: 'vllm',
    displayName: 'vLLM',
    statusBarName: 'vLLM',
    accessType: 'server',
    accessTypeLabel: 'local/server',
    credentialType: 'openai-compatible-endpoint',
    modelDiscoveryType: 'live',
    statusCheck: 'endpoint',
    listModels: 'openai-compatible-models',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'local',
    legalPath: 'OpenAI-compatible server',
    accessPathLabel: 'OpenAI-compatible endpoint runtime',
    defaultBaseUrl: 'http://localhost:8000/v1',
    endpointKind: 'openai-compatible',
  },
}

const PROVIDER_ALIAS_ENTRIES: ProviderAliasEntry[] = [
  {
    canonical: 'subscription',
    aliases: ['subscriptions', 'subscription login'],
  },
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

export function getActiveProviderSettings(settings: SettingsJson | null = getInitialSettings()): ProviderSettings {
  const effectiveSettings = settings ?? {}
  const configured = effectiveSettings.provider ?? {}
  const active = configured.active
    ? resolveProviderId(configured.active) ?? DEFAULT_PROVIDER_ID
    : DEFAULT_PROVIDER_ID
  const fallback =
    configured.fallback === 'disabled'
      ? 'disabled'
      : configured.fallback
        ? resolveProviderId(configured.fallback) ?? undefined
        : undefined
  return {
    active,
    model: configured.model ?? (configured.active ? undefined : effectiveSettings.model),
    baseUrl: configured.baseUrl,
    commandPath: configured.commandPath,
    fallback,
  }
}

export function getProviderRuntimeInfo(settings: SettingsJson | null = getInitialSettings()): ProviderRuntimeInfo {
  const providerSettings = getActiveProviderSettings(settings)
  const provider = providerSettings.active ?? DEFAULT_PROVIDER_ID
  const definition = getProviderDefinition(provider)
  return {
    provider,
    providerLabel: definition.statusBarName,
    accessType: definition.accessType,
    accessTypeLabel: getProviderAccessTypeLabel(definition),
    credentialType: definition.credentialType,
    providerKind: definition.providerKind,
    usesExternalCli: definition.usesExternalCli,
    supportsNativeToolCalls: definition.supportsNativeToolCalls,
    supportsNativeStreaming: definition.supportsNativeStreaming,
    safetyBoundary: definition.safetyBoundary,
    safetyBoundaryLabel: definition.safetyBoundaryLabel,
    runtimeBackend: getProviderRuntimeBackend(provider),
    authMode: definition.authMode,
    authLabel: authModeLabel(definition.authMode),
    model: providerSettings.model,
    baseUrl: providerSettings.baseUrl ?? definition.defaultBaseUrl,
    fallback: providerSettings.fallback,
  }
}

export function getProviderRuntimeBackend(providerId: ProviderId | string): string {
  const provider = resolveProviderId(providerId)
  switch (provider) {
    case 'subscription':
      return 'subscription:unconfigured'
    case 'ollama':
      return 'ollama'
    case 'lmstudio':
      return 'openai-compatible:lmstudio'
    case 'llama.cpp':
      return 'openai-compatible:llama.cpp'
    case 'vllm':
      return 'openai-compatible:vllm'
    case 'openai-compatible':
      return 'openai-compatible'
    case 'codex-cli':
      return 'subscription-cli:codex'
    case 'claude-code-cli':
      return 'subscription-cli:claude-code'
    case 'gemini-cli':
      return 'subscription-cli:gemini'
    case 'antigravity-cli':
      return 'subscription-cli:antigravity'
    case 'openai-api':
      return 'api:openai'
    case 'anthropic-api':
      return 'api:anthropic'
    case 'gemini-api':
      return 'api:gemini'
    case 'openrouter':
      return 'api:openrouter'
    default:
      return `unknown:${providerId}`
  }
}

const PROVIDER_FAMILIES: Record<ProviderId, ProviderFamily> = {
  subscription: 'subscription',
  'anthropic-api': 'anthropic',
  'claude-code-cli': 'anthropic',
  'openai-api': 'openai',
  'codex-cli': 'openai',
  'gemini-api': 'google',
  'gemini-cli': 'google',
  'antigravity-cli': 'google',
  openrouter: 'openai-compatible',
  'openai-compatible': 'openai-compatible',
  lmstudio: 'openai-compatible',
  'llama.cpp': 'openai-compatible',
  vllm: 'openai-compatible',
  ollama: 'ollama',
}

export function getProviderFamily(providerId: ProviderId | string): ProviderFamily {
  const provider = resolveProviderId(providerId)
  return provider ? PROVIDER_FAMILIES[provider] : 'openai-compatible'
}

// True selected provider id (never collapsed). This is the runtime source of
// provider identity for dispatch and request shaping.
export function getRuntimeProviderId(settings: SettingsJson = getInitialSettings()): ProviderId {
  return getActiveProviderSettings(settings).active ?? DEFAULT_PROVIDER_ID
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

export function getProviderAccessTypeLabel(provider: ProviderDefinition): string {
  return provider.accessTypeLabel ?? provider.accessType
}

export function credentialTypeLabel(type: ProviderCredentialType): string {
  switch (type) {
    case 'subscription-login':
      return 'subscription login'
    case 'cli-login':
      return 'subscription login'
    case 'api-key':
      return 'API key'
    case 'local-runtime':
      return 'local runtime'
    case 'openai-compatible-endpoint':
      return 'OpenAI-compatible endpoint'
  }
}

export function getProviderRuntimeKind(providerId: ProviderId | string): ProviderRuntimeKind | 'unknown' {
  const provider = resolveProviderId(providerId)
  return provider ? getProviderDefinition(provider).runtimeKind : 'unknown'
}

export function getProviderRuntimeBlockReason(
  providerId: ProviderId | string,
  env: Record<string, string | undefined> = process.env,
  settings: SettingsJson = getInitialSettings(),
): string | null {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return `Unknown provider "${providerId}". Run: ur provider list`
  }
  if (provider === 'subscription') {
    return `Provider "subscription" is an internal placeholder. Choose a specific subscription (codex-cli, claude-code-cli, gemini-cli, antigravity-cli) or an API/local/server provider with /model.`
  }
  // Subscriptions (Codex, Claude Code, Gemini, Antigravity) are first-class:
  // usable directly and dispatched through their official CLI. Log in with
  // `ur auth <provider>`. No runtime block. (env/settings kept for signature
  // compatibility with earlier gated behavior.)
  void env
  void settings
  return null
}

export function isProviderRuntimeSelectable(
  providerId: ProviderId | string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getProviderRuntimeBlockReason(providerId, env) === null
}

export function listProviders(
  _options: {
    includeExternalAppBridges?: boolean
    env?: Record<string, string | undefined>
  } = {},
): ProviderDefinition[] {
  // 1.30.3 approach: all real providers are listed, subscription CLIs included.
  // The internal generic "subscription" placeholder is hidden from listings.
  return PROVIDER_IDS
    .map(id => PROVIDERS[id])
    .filter(provider => provider.id !== 'subscription' && !provider.disabled)
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
  options: { source?: EditableSettingSource } = {},
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
  let providerModelInvalidated = false
  try {
    if (key === 'provider') {
      const provider = resolveProviderId(trimmed)
      if (!provider) {
        return {
          ok: false,
          message: `Unknown provider "${trimmed}". Run: ur provider list`,
        }
      }
      const runtimeBlock = getProviderRuntimeBlockReason(provider)
      if (runtimeBlock) {
        return {
          ok: false,
          message: runtimeBlock,
        }
      }
      const currentSettings = getInitialSettings()
      const currentModel = getActiveProviderSettings(currentSettings).model
      const nextProviderSettings: ProviderSettings = {
        active: provider,
        baseUrl: undefined,
        commandPath: undefined,
      }
      let invalidated = false
      if (currentModel) {
        const validation = validateProviderModelPair(provider, currentModel)
        if (validation.valid === false) {
          nextProviderSettings.model = undefined
          invalidated = true
          providerModelInvalidated = true
        }
      }
      settings = {
        provider: nextProviderSettings,
        ...(invalidated ? { model: undefined } : {}),
      } as SettingsJson
    } else if (key === 'provider.fallback') {
      const fallback = trimmed === 'disabled' ? 'disabled' : resolveProviderId(trimmed)
      if (!fallback) {
        return {
          ok: false,
          message: `Unknown fallback provider "${trimmed}". Run: ur provider list`,
        }
      }
      if (fallback !== 'disabled') {
        const runtimeBlock = getProviderRuntimeBlockReason(fallback)
        if (runtimeBlock) {
          return {
            ok: false,
            message: runtimeBlock,
          }
        }
      }
      settings = { provider: { fallback } } as SettingsJson
    } else if (key === 'provider.command_path') {
      settings = { provider: { commandPath: trimmed } } as SettingsJson
    } else if (key === 'model') {
      // Validate model against current provider
      const currentSettings = getInitialSettings()
      const currentProvider = getActiveProviderSettings(currentSettings).active ?? 'ollama'
      const runtimeBlock = getProviderRuntimeBlockReason(currentProvider)
      if (runtimeBlock) {
        return {
          ok: false,
          message: runtimeBlock,
        }
      }
      const validation = validateProviderModelPair(currentProvider, trimmed)
      if (validation.valid === false) {
        return {
          ok: false,
          message: validation.error,
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

  const source = options.source ?? 'localSettings'
  const result = updateSettingsForSource(source, settings)
  if (result.error) {
    return {
      ok: false,
      message: `Failed to write UR-Nexus settings: ${result.error.message}`,
    }
  }
  const savedValue =
    key === 'provider' || key === 'provider.fallback'
      ? key === 'provider.fallback' && trimmed === 'disabled'
        ? 'disabled'
        : resolveProviderId(trimmed) ?? trimmed
      : trimmed
  return {
    ok: true,
    message: `Set ${key} to ${savedValue}.${providerModelInvalidated ? ' Cleared incompatible model for the new provider; run /model to choose a scoped model.' : ''}`,
  }
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

/**
 * Candidate model-list URLs for an OpenAI-compatible endpoint. Users commonly
 * set base_url to just `host:port` (no `/v1`), which points model discovery at
 * `/models` — the wrong path for LM Studio, llama.cpp, and vLLM, which serve
 * their model list under `/v1`. When the base URL has no version/api segment we
 * also try `/v1/models` so discovery still finds models.
 */
function openAiCompatibleModelUrls(baseUrl: string): string[] {
  const url = new URL(normalizeBaseUrl(baseUrl))
  url.hash = ''
  url.search = ''
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/chat\/completions$/i, '')
  if (/\/models$/i.test(path)) {
    url.pathname = path
    return [url.toString().replace(/\/$/, '')]
  }
  if (/\/v\d+(?:beta)?$/i.test(path) || /\/api\/v\d+$/i.test(path)) {
    url.pathname = `${path}/models`
    return [url.toString().replace(/\/$/, '')]
  }
  const rootPath = path
  url.pathname = `${rootPath}/v1/models`
  const versioned = url.toString().replace(/\/$/, '')
  url.pathname = `${rootPath}/models`
  return [versioned, url.toString().replace(/\/$/, '')]
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
  const baseUrl =
    settings.baseUrl ??
    (definition.id === 'ollama' ? getOllamaBaseUrl() : definition.defaultBaseUrl)
  if (!baseUrl) {
    result.checks.push({
      name: 'base_url',
      status: 'fail',
      message: 'No base_url configured.',
    })
    addFailure(result, 'missing base_url', 'Run: ur config set base_url <url>')
    return
  }
  // Probe the same candidate paths discovery uses, so the doctor reflects the
  // URL that actually yields models (e.g. `/v1/models` when base_url omits /v1).
  const candidates =
    definition.endpointKind === 'ollama'
      ? [endpointUrl(baseUrl, 'ollama')]
      : openAiCompatibleModelUrls(baseUrl)
  const env = adapters.env ?? process.env
  let apiKey = definition.envKey ? env[definition.envKey] : undefined
  if (!apiKey && definition.credentialType === 'openai-compatible-endpoint') {
    try {
      const credentials = await import('./providerCredentials.js')
      apiKey = credentials.getProviderApiKey(definition.id, { env })
    } catch {
      // Endpoint may not require authentication.
    }
  }
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
  const fetchImpl = adapters.fetch ?? fetch
  let reachableUrl: string | undefined
  let modelsUrl: string | undefined
  let modelsBody = ''
  let lastStatus: number | undefined
  let lastError: Error | undefined
  for (const candidate of candidates) {
    let response: Response
    try {
      response = await fetchImpl(candidate, { method: 'GET', headers })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      continue
    }
    if (!response.ok) {
      lastStatus = response.status
      continue
    }
    reachableUrl ??= candidate
    const body = await response.text().catch(() => '')
    let parsed: unknown = null
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = null
    }
    const names =
      definition.endpointKind === 'ollama'
        ? parseOllamaModelNamesFromTags(parsed)
        : parseOpenAICompatibleModelNames(parsed)
    if (names.length > 0) {
      modelsUrl = candidate
      modelsBody = body
      break
    }
  }
  if (!reachableUrl) {
    if (lastStatus !== undefined) {
      result.checks.push({
        name: 'endpoint',
        status: 'fail',
        message: `${candidates[0]} returned HTTP ${lastStatus}.`,
      })
      addFailure(
        result,
        `endpoint returned HTTP ${lastStatus}`,
        `Start the provider server or update base_url: ur config set base_url ${baseUrl}`,
      )
    } else {
      result.checks.push({
        name: 'endpoint',
        status: 'fail',
        message: `${candidates[0]} is not reachable.`,
      })
      addFailure(
        result,
        lastError?.message ?? 'endpoint unavailable',
        `Start the provider server or update base_url: ur config set base_url ${baseUrl}`,
      )
    }
    return
  }
  const chosenUrl = modelsUrl ?? reachableUrl
  result.checks.push({
    name: 'endpoint',
    status: 'pass',
    message: `${chosenUrl} is reachable.`,
  })
  if (!modelsUrl) {
    result.checks.push({
      name: 'models',
      status: 'warn',
      message: `${reachableUrl} is reachable but returned no models. Load a model in the server, or check that base_url includes the API path (e.g. /v1).`,
    })
  }
  if (settings.model) {
    if (modelsBody && !modelsBody.includes(settings.model)) {
      result.checks.push({
        name: 'model',
        status: 'warn',
        message: `Model "${settings.model}" was not found in the detectable model list.`,
      })
    } else if (modelsBody) {
      result.checks.push({
        name: 'model',
        status: 'pass',
        message: `Model "${settings.model}" is detectable.`,
      })
    }
  }
}

async function checkSubscriptionProvider(
  definition: ProviderDefinition,
  settings: ProviderSettings,
  adapters: ProviderDoctorAdapters,
  result: ProviderDoctorResult,
): Promise<void> {
  if (definition.credentialType === 'subscription-login') {
    result.checks.push({
      name: 'subscription_runtime',
      status: 'fail',
      message: 'No independent subscription runtime is configured.',
    })
    addFailure(
      result,
      'subscription runtime unavailable',
      'Run /model and choose a connected local, server, or API provider.',
    )
    return
  }

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
          'Gemini CLI status is not exposed by this CLI. UR-Nexus will only use the official Gemini CLI flow and will not support personal-account bypasses.',
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
    let hasKey = Boolean(env[definition.envKey])
    let source: 'env' | 'stored' = 'env'
    // Runtime path only (no injected env): a key connected via `ur connect` is
    // stored in the secure store, so reflect it here. Dynamic import avoids a
    // static import cycle with providerCredentials.
    if (!hasKey && !adapters.env) {
      try {
        const { getStoredProviderApiKey } = await import('./providerCredentials.js')
        if (getStoredProviderApiKey(definition.id)) {
          hasKey = true
          source = 'stored'
        }
      } catch {
        // Secure store unavailable — fall back to env-only reporting.
      }
    }
    if (hasKey) {
      result.checks.push({
        name: 'api_key',
        status: 'pass',
        message: source === 'stored' ? 'Stored API key present (connected).' : `${definition.envKey} is present.`,
      })
    } else {
      result.checks.push({
        name: 'api_key',
        status: 'fail',
        message: `${definition.envKey} is not set and no stored key.`,
      })
      addFailure(result, 'API key missing', `Connect once: ur connect ${definition.id} (or set ${definition.envKey}).`)
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
        'Fallback is disabled. UR-Nexus will not silently switch providers. Optional: ur config set provider.fallback ollama',
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
    message: `Fallback is configured as ${settings.fallback}, but UR-Nexus will ask before using it.`,
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
  const active = provider ?? providerSettings.active ?? DEFAULT_PROVIDER_ID
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
    providerKind: definition.providerKind,
    usesExternalCli: definition.usesExternalCli,
    supportsNativeToolCalls: definition.supportsNativeToolCalls,
    supportsNativeStreaming: definition.supportsNativeStreaming,
    safetyBoundary: definition.safetyBoundary,
    safetyBoundaryLabel: definition.safetyBoundaryLabel,
    selected: active === providerSettings.active,
    ok: true,
    checks: [
      {
        name: 'legal_path',
        status: 'pass',
        message: definition.legalPath,
      },
      {
        name: 'runtime_boundary',
        status: 'pass',
        message: definition.safetyBoundaryLabel,
      },
    ],
  }

  if (definition.accessType === 'subscription') {
    await checkSubscriptionProvider(definition, settingsForProvider, options.adapters ?? {}, result)
  } else if (definition.accessType === 'api') {
    await checkApiProvider(definition, settingsForProvider, options.adapters ?? {}, result)
  } else if (definition.accessType === 'local' || definition.accessType === 'server') {
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
  const active = getActiveProviderSettings(settings).active ?? DEFAULT_PROVIDER_ID
  return doctorProvider(active, options)
}

export function getConnectionStatusFromDoctorResult(result: ProviderDoctorResult): ProviderConnectionStatus {
  if (result.ok) {
    return 'connected'
  }
  if (result.failureReason?.includes('CLI missing') || result.failureReason?.includes('not found')) {
    return 'missing'
  }
  if (
    result.failureReason?.includes('not logged in') ||
    result.failureReason?.includes('not authenticated') ||
    result.failureReason?.includes('subscription runtime unavailable') ||
    result.failureReason?.includes('API key missing') ||
    result.failureReason?.includes('endpoint') ||
    result.failureReason?.includes('HTTP')
  ) {
    return 'unavailable'
  }
  return 'unknown'
}

export function formatProviderStatusLabel(
  status: ProviderConnectionStatus,
  provider: ProviderDefinition,
  checks: ProviderCheck[],
): string {
  switch (status) {
    case 'connected':
      if (provider.credentialType === 'api-key' && provider.envKey) {
        return `${provider.envKey} found`
      }
      if (provider.id === 'ollama') {
        return 'localhost reachable'
      }
      if (provider.credentialType === 'openai-compatible-endpoint') {
        return 'OpenAI-compatible endpoint reachable'
      }
      if (provider.credentialType === 'cli-login') {
        return 'subscription login connected'
      }
      if (provider.credentialType === 'subscription-login') {
        return 'subscription connected'
      }
      return 'connected'
    case 'missing':
      if (provider.commandCandidates) {
        return `CLI not found (tried: ${provider.commandCandidates.join(', ')})`
      }
      return 'missing'
    case 'unavailable': {
      const failCheck = checks.find(check => check.status === 'fail' || check.status === 'warn')
      return failCheck?.message ?? 'unavailable'
    }
    case 'unknown':
      return 'status unknown'
  }
}

export async function getProviderStatus(
  providerId: ProviderId | string,
  options: {
    settings?: SettingsJson
    adapters?: ProviderDoctorAdapters
  } = {},
): Promise<ProviderStatusSummary> {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    throw new Error(`Unknown provider "${providerId}". Run: ur provider list`)
  }
  const definition = getProviderDefinition(provider)
  const doctor = await doctorProvider(provider, options)
  const status = getConnectionStatusFromDoctorResult(doctor)
  return {
    provider,
    displayName: definition.displayName,
    accessType: definition.accessType,
    accessTypeLabel: getProviderAccessTypeLabel(definition),
    credentialType: definition.credentialType,
    providerKind: definition.providerKind,
    usesExternalCli: definition.usesExternalCli,
    supportsNativeToolCalls: definition.supportsNativeToolCalls,
    supportsNativeStreaming: definition.supportsNativeStreaming,
    safetyBoundary: definition.safetyBoundary,
    safetyBoundaryLabel: definition.safetyBoundaryLabel,
    status,
    label: formatProviderStatusLabel(status, definition, doctor.checks),
    checks: doctor.checks,
    doctor,
  }
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
        'UR-Nexus will only launch the official Antigravity CLI. Use its documented login flow where supported; UR-Nexus will not invent flags or reuse browser sessions.',
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
    accessTypeLabel: getProviderAccessTypeLabel(provider),
    credentialType: provider.credentialType,
    modelDiscoveryType: provider.modelDiscoveryType,
    runtimeKind: provider.runtimeKind,
    providerKind: provider.providerKind,
    usesExternalCli: provider.usesExternalCli,
    supportsNativeToolCalls: provider.supportsNativeToolCalls,
    supportsNativeStreaming: provider.supportsNativeStreaming,
    runtimeBackend: getProviderRuntimeBackend(provider.id),
    safetyBoundary: provider.safetyBoundary,
    safetyBoundaryLabel: provider.safetyBoundaryLabel,
    authMode: provider.authMode,
    accessPath: provider.accessPathLabel,
    legalPath: provider.legalPath,
  }))
  if (json) {
    return JSON.stringify(providers, null, 2)
  }
  return [
    'Provider | ID | Aliases | Access type | Credential | Model discovery | Provider kind | External CLI | Native tools | Native streaming | Runtime backend | Boundary | Access path',
    '--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---',
    ...providers.map(provider =>
      `${provider.name} | ${provider.id} | ${provider.aliases.slice(0, 3).join(', ') || '-'} | ${provider.accessTypeLabel} | ${provider.credentialType} | ${provider.modelDiscoveryType} | ${provider.providerKind} | ${provider.usesExternalCli ? 'yes' : 'no'} | ${provider.supportsNativeToolCalls ? 'yes' : 'no'} | ${provider.supportsNativeStreaming ? 'yes' : 'no'} | ${provider.runtimeBackend} | ${provider.safetyBoundary} | ${provider.accessPath}`,
    ),
  ].join('\n')
}

export function formatProviderDoctor(result: ProviderDoctorResult, json = false): string {
  if (json) {
    return JSON.stringify(result, null, 2)
  }
  const runtimeBlock = getProviderRuntimeBlockReason(result.provider)
  const lines = [
    `Provider: ${result.displayName} (${result.provider})`,
    `Access: ${getProviderAccessTypeLabel(getProviderDefinition(result.provider))}`,
    `Credential: ${getProviderDefinition(result.provider).credentialType}`,
    `Runtime kind: ${getProviderDefinition(result.provider).runtimeKind}`,
    `Provider kind: ${result.providerKind}`,
    `Uses external CLI: ${result.usesExternalCli ? 'yes' : 'no'}`,
    `UR-native tool calls: ${result.supportsNativeToolCalls ? 'yes' : 'no'}`,
    `UR-native streaming: ${result.supportsNativeStreaming ? 'yes' : 'no'}`,
    `Runtime backend: ${getProviderRuntimeBackend(result.provider)}`,
    `Safety boundary: ${result.safetyBoundaryLabel}`,
    `Runtime available: ${runtimeBlock ? 'no' : 'yes'}`,
    `Auth: ${authModeLabel(result.authMode)}`,
    `Status: ${result.ok ? 'ready' : 'not ready'}`,
  ]
  if (runtimeBlock) {
    lines.push(`Runtime note: ${runtimeBlock}`)
  }
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
  const definition = getProviderDefinition(result.provider)
  const settings = getActiveProviderSettings(getInitialSettings())
  const model = settings.model ? `\nActive model: ${settings.model}` : ''
  const runtimeBlock = getProviderRuntimeBlockReason(result.provider)
  const runtime = `\nRuntime available: ${runtimeBlock ? 'no' : 'yes'}${runtimeBlock ? `\nRuntime note: ${runtimeBlock}` : ''}`
  return `Selected provider: ${result.displayName} (${result.provider})\nAccess type: ${getProviderAccessTypeLabel(definition)}\nCredential: ${definition.credentialType}\nRuntime kind: ${definition.runtimeKind}\nProvider kind: ${result.providerKind}\nUses external CLI: ${result.usesExternalCli ? 'yes' : 'no'}\nUR-native tool calls: ${result.supportsNativeToolCalls ? 'yes' : 'no'}\nUR-native streaming: ${result.supportsNativeStreaming ? 'yes' : 'no'}\nRuntime backend: ${getProviderRuntimeBackend(result.provider)}\nSafety boundary: ${result.safetyBoundaryLabel}${model}${runtime}\nAuth mode: ${authModeLabel(result.authMode)}\nReady: ${result.ok ? 'yes' : 'no'}${failure}${fix}`
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
  // Generic subscription entry. No models are listed because this build has no
  // independent subscription backend. External app bridges keep their own
  // scoped lists behind explicit opt-in.
  subscription: [],
  // OpenAI subscription CLI (codex) - uses Codex CLI subscription login
  'codex-cli': [
    { id: 'codex/gpt-5.5', displayName: 'GPT-5.5 (Codex CLI)', description: 'Subscription model through official Codex CLI login', isDefault: true },
    { id: 'codex/gpt-5.4', displayName: 'GPT-5.4 (Codex CLI)', description: 'Subscription model through official Codex CLI login' },
    { id: 'codex/gpt-5.4-mini', displayName: 'GPT-5.4 Mini (Codex CLI)', description: 'Fast subscription model through official Codex CLI login' },
    { id: 'codex/gpt-4o', displayName: 'GPT-4o (Codex CLI)', description: 'Subscription model through official Codex CLI login' },
    { id: 'codex/gpt-4o-mini', displayName: 'GPT-4o Mini (Codex CLI)', description: 'Fast subscription model through official Codex CLI login' },
    { id: 'codex/o1', displayName: 'o1 (Codex CLI)', description: 'Reasoning model through official Codex CLI login' },
    { id: 'codex/o3-mini', displayName: 'o3-mini (Codex CLI)', description: 'Fast reasoning model through official Codex CLI login' },
  ],
  // Anthropic subscription CLI (Claude Code) - uses Claude Code subscription
  'claude-code-cli': [
    { id: 'claude-code/sonnet', displayName: 'Claude Sonnet (Claude Code)', description: 'Claude Code CLI alias resolved by the official CLI', isDefault: true },
    { id: 'claude-code/opus', displayName: 'Claude Opus (Claude Code)', description: 'Claude Code CLI alias; requires Opus access on the signed-in account' },
    { id: 'claude-code/fable', displayName: 'Claude Fable (Claude Code)', description: 'Claude Code CLI alias resolved by the official CLI where available' },
  ],
  // Google subscription CLI (Gemini Code Assist) - uses Gemini enterprise subscription
  'gemini-cli': [
    { id: 'gemini-cli/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro (Gemini CLI)', description: 'Subscription model through official Gemini CLI login', isDefault: true },
    { id: 'gemini-cli/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (Gemini CLI)', description: 'Subscription model through official Gemini CLI login' },
    { id: 'gemini-cli/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite (Gemini CLI)', description: 'Subscription model through official Gemini CLI login' },
  ],
  // Antigravity CLI - Google's agentic platform
  'antigravity-cli': [
    { id: 'antigravity/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash (Antigravity)', description: 'Subscription model through official Antigravity login', isDefault: true },
    { id: 'antigravity/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro (Antigravity)', description: 'Subscription model through official Antigravity login' },
    { id: 'antigravity/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (Antigravity)', description: 'Subscription model through official Antigravity login' },
  ],
  // OpenAI API - direct API access with OPENAI_API_KEY
  'openai-api': [
    { id: 'gpt-5.5', displayName: 'GPT-5.5', description: 'Latest OpenAI model', isDefault: true },
    { id: 'gpt-5.4', displayName: 'GPT-5.4', description: 'Advanced reasoning and coding' },
    { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', description: 'Fast, efficient variant' },
    { id: 'gpt-4o', displayName: 'GPT-4o', description: 'Previous generation flagship' },
    { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', description: 'Fast GPT-4o variant' },
    { id: 'o1', displayName: 'o1', description: 'Deep reasoning model' },
    { id: 'o3-mini', displayName: 'o3-mini', description: 'Fast reasoning model' },
  ],
  // Anthropic API - direct API access with ANTHROPIC_API_KEY
  'anthropic-api': [
    { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', description: 'Balanced performance and speed', isDefault: true },
    { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', description: 'Most powerful Claude model' },
    { id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7', description: 'High-end reasoning' },
    { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', description: 'Advanced problem solving' },
    { id: 'claude-opus-4-5', displayName: 'Claude Opus 4.5', description: 'Previous Opus generation' },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', description: 'Fast Sonnet variant' },
    { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', description: 'Previous Sonnet generation' },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', description: 'Fastest Claude model' },
  ],
  // Google Gemini API - direct API access with GEMINI_API_KEY
  'gemini-api': [
    { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', description: 'Most intelligent for agentic tasks', isDefault: true },
    { id: 'gemini-3.1-pro', displayName: 'Gemini 3.1 Pro', description: 'Advanced problem solving (preview)' },
    { id: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite', description: 'Budget-friendly performance' },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', description: 'Complex reasoning and coding' },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', description: 'Low-latency tasks' },
    { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', description: 'Fastest Gemini model' },
  ],
  // OpenRouter - multi-provider router (openai/*, anthropic/*, google/*, etc.)
  'openrouter': [
    { id: 'openai/gpt-5.5', displayName: 'GPT-5.5', description: 'OpenAI GPT-5.5 via OpenRouter', isDefault: true },
    { id: 'openai/gpt-5.4', displayName: 'GPT-5.4', description: 'OpenAI GPT-5.4 via OpenRouter' },
    { id: 'openai/gpt-4o', displayName: 'GPT-4o', description: 'OpenAI GPT-4o via OpenRouter' },
    { id: 'anthropic/claude-sonnet-5', displayName: 'Claude Sonnet 5', description: 'Anthropic Claude via OpenRouter' },
    { id: 'anthropic/claude-opus-4-8', displayName: 'Claude Opus 4.8', description: 'Anthropic Claude via OpenRouter' },
    { id: 'google/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', description: 'Google Gemini via OpenRouter' },
    { id: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', description: 'Google Gemini via OpenRouter' },
  ],
  // OpenAI-compatible endpoint - dynamic discovery from custom base_url
  'openai-compatible': [
    { id: 'custom', displayName: 'Custom Model', description: 'Model name from provider endpoint', isDynamic: true },
  ],
  // Ollama - local runtime with dynamic model discovery
  'ollama': [
    { id: 'dynamic', displayName: 'Discovered Models', description: 'Models discovered from Ollama server', isDynamic: true, isDefault: true },
  ],
  // LM Studio - local OpenAI-compatible server
  'lmstudio': [
    { id: 'dynamic', displayName: 'Discovered Models', description: 'Models discovered from LM Studio server', isDynamic: true, isDefault: true },
  ],
  // llama.cpp - local server mode
  'llama.cpp': [
    { id: 'dynamic', displayName: 'Discovered Models', description: 'Models discovered from llama.cpp server', isDynamic: true, isDefault: true },
  ],
  // vLLM - local/server OpenAI-compatible
  'vllm': [
    { id: 'dynamic', displayName: 'Discovered Models', description: 'Models discovered from vLLM server', isDynamic: true, isDefault: true },
  ],
}

const cachedModelsByProvider = new Map<ProviderId, ProviderModelDefinition[]>()

export function clearProviderModelCacheForTests(): void {
  cachedModelsByProvider.clear()
}

function providerBaseUrl(
  provider: ProviderId,
  definition: ProviderDefinition,
  settings: SettingsJson,
): string | undefined {
  const providerSettings = getActiveProviderSettings(settings)
  if (providerSettings.baseUrl) {
    return providerSettings.baseUrl
  }
  if (provider === 'ollama') {
    return getOllamaBaseUrl(process.env, settings)
  }
  return definition.defaultBaseUrl
}

function parseOpenAICompatibleModelNames(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  const data = (value as { data?: unknown; models?: unknown }).data ?? (value as { models?: unknown }).models
  if (!Array.isArray(data)) {
    return []
  }
  const names = data.flatMap(model => {
    if (typeof model === 'string') {
      const trimmed = model.trim()
      return trimmed ? [trimmed] : []
    }
    if (!model || typeof model !== 'object') {
      return []
    }
    const entry = model as { id?: unknown; name?: unknown; model?: unknown }
    const name = entry.id ?? entry.name ?? entry.model
    if (typeof name !== 'string') {
      return []
    }
    const trimmed = name.trim()
    return trimmed ? [trimmed] : []
  })
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

function parseOllamaModelNamesFromTags(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('models' in value)) {
    return []
  }
  const models = (value as { models?: unknown }).models
  if (!Array.isArray(models)) {
    return []
  }
  const names = models.flatMap(model => {
    if (!model || typeof model !== 'object') {
      return []
    }
    const entry = model as { name?: unknown; model?: unknown }
    const name = entry.name ?? entry.model
    if (typeof name !== 'string') {
      return []
    }
    const trimmed = name.trim()
    return trimmed ? [trimmed] : []
  })
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

function modelDefinitionsFromNames(
  provider: ProviderId,
  names: string[],
  source: ProviderModelSource,
): ProviderModelDefinition[] {
  const providerName = getProviderDefinition(provider).displayName
  return names.map(name => ({
    id: name,
    displayName: name,
    description:
      source === 'cache'
        ? `Cached ${providerName} model`
        : `Discovered from ${providerName}`,
  }))
}

function getCachedProviderModels(provider: ProviderId): ProviderModelDefinition[] {
  return cachedModelsByProvider.get(provider) ?? []
}

export function cacheProviderModelsForProvider(
  providerId: ProviderId | string,
  models: string[] | ProviderModelDefinition[],
): void {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return
  }
  const definitions =
    typeof models[0] === 'string'
      ? modelDefinitionsFromNames(provider, models as string[], 'cache')
      : (models as ProviderModelDefinition[])
  if (definitions.length > 0) {
    cachedModelsByProvider.set(provider, definitions)
  }
}

function staticModelsForProvider(provider: ProviderId): ProviderModelDefinition[] {
  return (PROVIDER_MODELS[provider] ?? []).filter(model => !model.isDynamic)
}

async function discoverLiveModelsForProvider(
  provider: ProviderId,
  options: {
    settings?: SettingsJson
    adapters?: ProviderDoctorAdapters
    signal?: AbortSignal
  } = {},
): Promise<ProviderModelDefinition[]> {
  const definition = getProviderDefinition(provider)
  if (!definition.endpointKind) {
    if (definition.accessType === 'api' && definition.modelDiscoveryType === 'live') {
      return discoverApiProviderModels(provider, definition, options)
    }
    return []
  }
  const settings = options.settings ?? getInitialSettings()
  const baseUrl = providerBaseUrl(provider, definition, settings)
  if (!baseUrl) {
    throw new Error(`No base_url configured for provider "${provider}".`)
  }
  const env = options.adapters?.env ?? process.env
  const fetchImpl = options.adapters?.fetch ?? fetch
  let apiKey = definition.envKey ? env[definition.envKey] : undefined
  if (!apiKey) {
    try {
      const credentials = await import('./providerCredentials.js')
      apiKey = credentials.getProviderApiKey(provider, { env })
    } catch {
      // Endpoint may not require authentication.
    }
  }
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined

  if (definition.endpointKind === 'ollama') {
    const url = endpointUrl(baseUrl, 'ollama')
    const response = await fetchImpl(url, { method: 'GET', signal: options.signal, headers })
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}.`)
    }
    const names = parseOllamaModelNamesFromTags(await response.json())
    return modelDefinitionsFromNames(provider, names, 'live')
  }

  // OpenAI-compatible: try candidate paths (`/models`, then `/v1/models` when
  // the base URL omits a version segment). Return the first that yields models;
  // if a server is reachable but has none, return empty ("no models") rather
  // than throwing; only throw when no candidate is reachable at all.
  let reachedOk = false
  let lastError: Error | undefined
  for (const url of openAiCompatibleModelUrls(baseUrl)) {
    let response: Response
    try {
      response = await fetchImpl(url, { method: 'GET', signal: options.signal, headers })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      continue
    }
    if (!response.ok) {
      lastError = new Error(`${url} returned HTTP ${response.status}.`)
      continue
    }
    reachedOk = true
    const body = await response.json().catch(() => null)
    const names = parseOpenAICompatibleModelNames(body)
    if (names.length > 0) {
      return modelDefinitionsFromNames(provider, names, 'live')
    }
  }
  if (!reachedOk && lastError) {
    throw lastError
  }
  return []
}

function apiModelsRequest(
  provider: ProviderId,
  apiKey: string,
  settings: SettingsJson,
): { url: string; headers: Record<string, string> } {
  const configured = getActiveProviderSettings(settings)
  const configuredBase = configured.active === provider ? configured.baseUrl : undefined
  const modelsUrl = (baseUrl: string, version: string): string => {
    const url = new URL(normalizeBaseUrl(baseUrl))
    url.hash = ''
    url.search = ''
    let path = url.pathname.replace(/\/+$/, '')
    path = path.replace(/\/(chat\/completions|messages|models)$/i, '')
    if (!/\/v\d+(?:beta)?$/i.test(path) && !/\/api\/v\d+$/i.test(path)) {
      path = `${path}/${version}`
    }
    url.pathname = `${path}/models`
    return url.toString().replace(/\/$/, '')
  }
  switch (provider) {
    case 'anthropic-api':
      return {
        url: modelsUrl(configuredBase ?? 'https://api.anthropic.com/v1', 'v1'),
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      }
    case 'gemini-api':
      return {
        url: modelsUrl(configuredBase ?? 'https://generativelanguage.googleapis.com/v1beta', 'v1beta'),
        headers: { 'x-goog-api-key': apiKey },
      }
    case 'openrouter':
      return {
        url: modelsUrl(configuredBase ?? 'https://openrouter.ai/api/v1', 'v1'),
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    default:
      return {
        url: modelsUrl(configuredBase ?? 'https://api.openai.com/v1', 'v1'),
        headers: { Authorization: `Bearer ${apiKey}` },
      }
  }
}

function parseApiModelIds(provider: ProviderId, body: unknown): string[] {
  const root = (body ?? {}) as Record<string, unknown>
  if (provider === 'gemini-api') {
    const models = Array.isArray(root.models) ? (root.models as Array<Record<string, unknown>>) : []
    const names = models
      .filter(m => {
        const methods = m.supportedGenerationMethods
        return !Array.isArray(methods) || methods.includes('generateContent')
      })
      .map(m => (typeof m.name === 'string' ? m.name.replace(/^models\//, '') : ''))
      .filter(Boolean)
    return [...new Set(names)].sort((a, b) => a.localeCompare(b))
  }
  const data = Array.isArray(root.data) ? (root.data as Array<Record<string, unknown>>) : []
  const names = data.map(m => (typeof m.id === 'string' ? m.id : '')).filter(Boolean)
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

async function discoverApiProviderModels(
  provider: ProviderId,
  definition: ProviderDefinition,
  options: {
    settings?: SettingsJson
    adapters?: ProviderDoctorAdapters
    signal?: AbortSignal
  },
): Promise<ProviderModelDefinition[]> {
  const env = options.adapters?.env ?? process.env
  let apiKey = definition.envKey ? env[definition.envKey] : undefined
  if (!apiKey) {
    try {
      const { getProviderApiKey } = await import('./providerCredentials.js')
      apiKey = getProviderApiKey(provider, { env })
    } catch {
      // Secure store unavailable — treated as not connected below.
    }
  }
  if (!apiKey) {
    throw new Error(`Not connected: run \`ur connect ${provider}\` to add an API key.`)
  }
  const { url, headers } = apiModelsRequest(
    provider,
    apiKey,
    options.settings ?? getInitialSettings(),
  )
  const response = await (options.adapters?.fetch ?? fetch)(url, {
    method: 'GET',
    signal: options.signal,
    headers,
  })
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`)
  }
  const body = await response.json()
  return modelDefinitionsFromNames(provider, parseApiModelIds(provider, body), 'live')
}

export async function listModelsForProviderWithSource(
  providerId: ProviderId | string,
  options: {
    settings?: SettingsJson
    adapters?: ProviderDoctorAdapters
    signal?: AbortSignal
  } = {},
): Promise<ProviderModelDiscoveryResult> {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return {
      provider: 'ollama',
      models: [],
      source: 'static',
      warning: `Unknown provider "${providerId}". Run: ur provider list`,
    }
  }

  const definition = getProviderDefinition(provider)
  if (definition.modelDiscoveryType === 'static') {
    return {
      provider,
      models: staticModelsForProvider(provider),
      source: 'static',
    }
  }

  try {
    const liveModels = await discoverLiveModelsForProvider(provider, options)
    if (liveModels.length > 0) {
      cachedModelsByProvider.set(provider, liveModels)
      return {
        provider,
        models: liveModels,
        source: 'live',
      }
    }
    const cachedModels = getCachedProviderModels(provider)
    if (cachedModels.length > 0) {
      return {
        provider,
        models: cachedModels,
        source: 'cache',
        warning: `Live model discovery for "${provider}" returned no models. Showing cached ${provider} models only.`,
      }
    }
    const staticModels = staticModelsForProvider(provider)
    return {
      provider,
      models: staticModels,
      source: staticModels.length > 0 ? 'static' : 'live',
      warning: `Live model discovery for "${provider}" returned no models.`,
    }
  } catch (error) {
    const cachedModels = getCachedProviderModels(provider)
    if (cachedModels.length > 0) {
      return {
        provider,
        models: cachedModels,
        source: 'cache',
        warning: `Live model discovery for "${provider}" failed: ${error instanceof Error ? error.message : String(error)}. Showing cached ${provider} models only.`,
      }
    }
    const staticModels = staticModelsForProvider(provider)
    return {
      provider,
      models: staticModels,
      source: staticModels.length > 0 ? 'static' : 'live',
      warning: `Live model discovery for "${provider}" failed: ${error instanceof Error ? error.message : String(error)}.`,
    }
  }
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
  return validateProviderModelPair(providerId, modelId).valid
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
  const defaultModel = models.find(m => m.isDefault && !m.isDynamic) ?? models.find(m => !m.isDynamic)
  return defaultModel?.id
}

/**
 * Get valid model IDs for a provider (for error messages and validation).
 */
export function getValidModelIdsForProvider(providerId: ProviderId | string): string[] {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return []
  }
  const cached = getCachedProviderModels(provider)
  if (cached.length > 0) {
    return cached.map(model => model.id)
  }
  return staticModelsForProvider(provider).map(model => model.id)
}

export function formatInvalidProviderModelMessage(
  providerId: ProviderId | string,
  modelId: string,
  validModels: string[],
  suggestedModel?: string,
): string {
  const provider = resolveProviderId(providerId) ?? String(providerId)
  const validList = validModels.length > 0 ? validModels.join(', ') : '(no models discovered)'
  const suggested = suggestedModel ?? validModels[0] ?? '<valid-model>'
  return `Model "${modelId}" is not available for provider "${provider}". Valid models for ${provider}: ${validList}. Run /model and choose a model from ${provider}, or run: ur config set model ${suggested}`
}

/**
 * Validate that a provider-model pair is compatible.
 * Returns an error message if invalid, or null if valid.
 */
export function validateProviderModelPair(
  providerId: ProviderId | string,
  modelId: string,
  options: {
    availableModels?: Array<string | ProviderModelDefinition>
    allowUncachedDynamic?: boolean
  } = {},
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

  const suppliedModels = (options.availableModels ?? []).map(model =>
    typeof model === 'string' ? model : model.id,
  )
  const cachedModels = getCachedProviderModels(provider).map(model => model.id)
  const staticModelIds = staticModelsForProvider(provider).map(model => model.id)
  // Live-discovery providers (local/server and now the API providers) are
  // dynamic: their authoritative list comes from the provider, not the curated
  // fallback baked into PROVIDER_MODELS.
  const hasDynamicModels =
    models.some(model => model.isDynamic) ||
    getProviderDefinition(provider).modelDiscoveryType === 'live'
  const validModelIds =
    suppliedModels.length > 0
      ? suppliedModels
      : hasDynamicModels
        ? cachedModels.length > 0
          ? cachedModels
          : staticModelIds
        : Array.from(new Set([...staticModelIds, ...cachedModels]))

  if (validModelIds.includes(modelId)) {
    return { valid: true }
  }

  // No authoritative (discovered/supplied) list yet — e.g. a saved model on a
  // cold process before discovery has run. Accept it rather than rejecting a
  // valid pair; discovery refines the list once the provider is reachable.
  const noAuthoritativeList = cachedModels.length === 0 && suppliedModels.length === 0
  if (hasDynamicModels && options.allowUncachedDynamic && noAuthoritativeList) {
    return { valid: true }
  }

  const defaultModel = getDefaultModelForProvider(provider)

  return {
    valid: false,
    error: formatInvalidProviderModelMessage(provider, modelId, validModelIds, defaultModel),
    validModels: validModelIds,
    suggestedModel: defaultModel,
  }
}

export const validateProviderModelCompatibility = validateProviderModelPair

export function setProviderModel(
  providerId: ProviderId | string,
  modelId: string,
  options: {
    availableModels?: Array<string | ProviderModelDefinition>
    modelSource?: ProviderModelSource
    source?: EditableSettingSource
  } = {},
): { ok: true; message: string; provider: ProviderId; model: string; modelSource: ProviderModelSource } | { ok: false; message: string } {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return {
      ok: false,
      message: `Unknown provider "${providerId}". Run: ur provider list`,
    }
  }
  const runtimeBlock = getProviderRuntimeBlockReason(provider)
  if (runtimeBlock) {
    return {
      ok: false,
      message: runtimeBlock,
    }
  }
  const validation = validateProviderModelPair(provider, modelId, {
    availableModels: options.availableModels,
  })
  if (validation.valid === false) {
    return {
      ok: false,
      message: validation.error,
    }
  }
  const source = options.source ?? 'localSettings'
  const result = updateSettingsForSource(source, {
    provider: {
      active: provider,
      model: modelId,
    },
    model: modelId,
  } as SettingsJson)
  if (result.error) {
    return {
      ok: false,
      message: `Failed to write UR-Nexus settings: ${result.error.message}`,
    }
  }
  return {
    ok: true,
    message: `Selected provider ${provider} (${getProviderAccessTypeLabel(getProviderDefinition(provider))}) with model ${modelId} (${options.modelSource ?? 'static'}).`,
    provider,
    model: modelId,
    modelSource: options.modelSource ?? 'static',
  }
}
