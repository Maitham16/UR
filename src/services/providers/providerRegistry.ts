import { spawn } from 'node:child_process'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import {
  getOllamaBaseUrl,
  getOllamaSessionOverride,
  normalizeOllamaBaseUrl,
} from '../../utils/model/ollamaConfig.js'
import { getInitialSettings, updateSettingsForSource } from '../../utils/settings/settings.js'
import type { EditableSettingSource } from '../../utils/settings/constants.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { which } from '../../utils/which.js'
import { normalizeGeminiBaseUrl } from '../api/providerHttp.js'
import {
  describeCacheAge,
  MODEL_CACHE_TTL_MS,
  parseDiscoveredModels,
  parseModelReasoningCapabilities,
  RequestCoalescer,
  type DiscoveredModel,
  type ModelReasoningCapabilities,
} from './modelCatalog.js'

export const PROVIDER_IDS = [
  'ollama',
  'subscription',
  'lmstudio',
  'llama.cpp',
  'vllm',
  'unsloth',
  'openai-compatible',
  'openai-api',
  'anthropic-api',
  'gemini-api',
  'openrouter',
  'nvidia-nim',
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

export type OpenRouterRoutingStrategy =
  | 'auto'
  | 'throughput'
  | 'latency'
  | 'price'

export type OpenRouterSettings = {
  /**
   * `auto` keeps OpenRouter Auto Exacto for tool turns and optimizes ordinary
   * text turns for end-to-end throughput. Other values force that provider
   * sort for every request.
   */
  routing?: OpenRouterRoutingStrategy
  allowFallbacks?: boolean
  requireParameters?: boolean
  preferredMinThroughput?: number
  preferredMaxLatency?: number
  serviceTier?: 'auto' | 'default' | 'flex' | 'priority' | 'fast'
  speed?: 'standard' | 'fast'
}

export type ProviderSettings = {
  active?: ProviderId
  model?: string
  baseUrl?: string
  baseUrls?: Partial<Record<ProviderId, string>>
  commandPath?: string
  fallback?: ProviderId | 'disabled'
  openaiTransport?: 'chat-completions' | 'responses'
  responses?: {
    store?: boolean
    compactThreshold?: number
    toolSearch?: 'off' | 'hosted'
  }
  openrouter?: OpenRouterSettings
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
  requiresApiKey?: boolean
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
  /** Effective provider-scoped endpoint (configured override or provider default). */
  baseUrl?: string
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
  /** Optional credential resolver for deterministic diagnostics and discovery
   *  tests. When supplied, it is authoritative for stored credentials; env
   *  variables still take precedence at each call site. */
  getApiKey?: (
    provider: ProviderId,
    env: Record<string, string | undefined>,
  ) => string | undefined
}

async function storedProviderApiKey(
  provider: ProviderId,
  env: Record<string, string | undefined>,
  adapters?: ProviderDoctorAdapters,
): Promise<string | undefined> {
  if (adapters?.getApiKey) return adapters.getApiKey(provider, env)
  try {
    const credentials = await import('./providerCredentials.js')
    return credentials.getProviderApiKey(provider, { env })
  } catch {
    return undefined
  }
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

/**
 * Where the currently displayed catalogue came from. `unavailable` is
 * intentionally distinct from `live`: a failed or empty discovery must never
 * be presented as a successfully fetched live catalogue.
 */
export type ProviderModelSource = 'live' | 'cache' | 'static' | 'unavailable'

export type ProviderModelDiscoveryResult = {
  provider: ProviderId
  models: ProviderModelDefinition[]
  source: ProviderModelSource
  warning?: string
}

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
    defaultBaseUrl: 'https://api.openai.com/v1',
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
    defaultBaseUrl: 'https://api.anthropic.com/v1',
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
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
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
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  'nvidia-nim': {
    id: 'nvidia-nim',
    displayName: 'NVIDIA NIM',
    statusBarName: 'NVIDIA NIM',
    accessType: 'api',
    accessTypeLabel: 'hosted/server',
    credentialType: 'api-key',
    modelDiscoveryType: 'live',
    statusCheck: 'endpoint',
    listModels: 'openai-compatible-models',
    validateModel: 'discovered-list',
    runtimeKind: 'ur-native',
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'api',
    legalPath: 'NVIDIA API key from build.nvidia.com or an authenticated NVIDIA NIM endpoint',
    accessPathLabel: 'NVIDIA NIM OpenAI-compatible endpoint',
    envKey: 'NVIDIA_API_KEY',
    requiresApiKey: true,
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    endpointKind: 'openai-compatible',
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
    legalPath: 'configured Ollama endpoint (local, LAN, or hosted; optional API key)',
    accessPathLabel: 'Ollama endpoint',
    envKey: 'OLLAMA_API_KEY',
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
    ...UR_NATIVE_CAPABILITIES,
    authMode: 'local',
    legalPath: 'configured LM Studio OpenAI-compatible endpoint (optional API key)',
    accessPathLabel: 'LM Studio endpoint',
    envKey: 'LMSTUDIO_API_KEY',
    defaultBaseUrl: 'http://localhost:1234/v1',
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
    legalPath: 'configured llama.cpp OpenAI-compatible endpoint (optional API key)',
    accessPathLabel: 'llama.cpp endpoint',
    envKey: 'LLAMA_CPP_API_KEY',
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
    legalPath: 'configured vLLM OpenAI-compatible endpoint (optional API key)',
    accessPathLabel: 'vLLM endpoint',
    envKey: 'VLLM_API_KEY',
    defaultBaseUrl: 'http://localhost:8000/v1',
    endpointKind: 'openai-compatible',
  },
  unsloth: {
    id: 'unsloth',
    displayName: 'Unsloth',
    statusBarName: 'Unsloth',
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
    legalPath: 'user-run authenticated Unsloth Studio OpenAI-compatible inference endpoint',
    accessPathLabel: 'authenticated Unsloth Studio endpoint',
    envKey: 'UNSLOTH_API_KEY',
    requiresApiKey: true,
    defaultBaseUrl: 'http://localhost:8888/v1',
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
    canonical: 'nvidia-nim',
    aliases: ['nvidia', 'nvidia api', 'nvidia build', 'nvidia nim', 'nim'],
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
  {
    canonical: 'unsloth',
    aliases: ['unsloth studio', 'unsloth server', 'unsloth local'],
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

/**
 * Return only the URL explicitly configured for one provider. `baseUrl` is
 * retained as a read-only compatibility path for settings written before
 * provider-scoped URLs existed; once `baseUrls` is present it cannot leak that
 * legacy value into a different provider.
 */
export function getScopedProviderBaseUrl(
  provider: ProviderId,
  settings: SettingsJson | null = getInitialSettings(),
): string | undefined {
  const configured = (settings ?? {}).provider ?? {}
  if (provider === 'subscription') return undefined
  const scoped = configured.baseUrls?.[provider]
  if (scoped) return scoped
  if (configured.baseUrls !== undefined) return undefined

  const active = configured.active
    ? resolveProviderId(configured.active) ?? DEFAULT_PROVIDER_ID
    : DEFAULT_PROVIDER_ID
  return active === provider ? configured.baseUrl : undefined
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
    baseUrl: getScopedProviderBaseUrl(active, effectiveSettings),
    baseUrls: configured.baseUrls,
    commandPath: configured.commandPath,
    fallback,
    openaiTransport: configured.openaiTransport,
    responses: configured.responses,
    openrouter: configured.openrouter,
  }
}

export function getProviderRuntimeInfo(settings: SettingsJson | null = getInitialSettings()): ProviderRuntimeInfo {
  const effectiveSettings = settings ?? {}
  const providerSettings = getActiveProviderSettings(effectiveSettings)
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
    baseUrl: providerBaseUrl(provider, definition, effectiveSettings),
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
    case 'unsloth':
      return 'openai-compatible:unsloth'
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
    case 'nvidia-nim':
      return 'api:nvidia-nim'
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
  'nvidia-nim': 'openai-compatible',
  'openai-compatible': 'openai-compatible',
  lmstudio: 'openai-compatible',
  'llama.cpp': 'openai-compatible',
  vllm: 'openai-compatible',
  unsloth: 'openai-compatible',
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

/**
 * Build the endpoint portion of a provider switch. The first switch made from
 * legacy settings migrates the old active provider's URL into the scoped map.
 * The legacy field remains a mirror of the newly active provider for older
 * consumers, but runtime resolution always prefers `baseUrls`.
 */
function endpointSettingsForProviderSwitch(
  settings: SettingsJson,
  nextProvider: ProviderId,
): Pick<ProviderSettings, 'baseUrl' | 'baseUrls'> {
  const configured = settings.provider ?? {}
  const currentProvider = getActiveProviderSettings(settings).active ?? DEFAULT_PROVIDER_ID
  const baseUrls: Partial<Record<ProviderId, string>> = {}

  if (configured.baseUrls === undefined && configured.baseUrl) {
    baseUrls[currentProvider] = configured.baseUrl
  }

  const nextBaseUrl =
    (nextProvider === 'subscription'
      ? undefined
      : configured.baseUrls?.[nextProvider]) ??
    (configured.baseUrls === undefined && currentProvider === nextProvider
      ? configured.baseUrl
      : undefined)

  return {
    baseUrl: nextBaseUrl,
    baseUrls,
  }
}

export function setSafeProviderConfig(
  key:
    | 'provider'
    | 'provider.fallback'
    | 'provider.command_path'
    | 'openai_transport'
    | 'responses.store'
    | 'responses.compact_threshold'
    | 'responses.tool_search'
    | 'openrouter.routing'
    | 'openrouter.allow_fallbacks'
    | 'openrouter.require_parameters'
    | 'openrouter.preferred_min_throughput'
    | 'openrouter.preferred_max_latency'
    | 'openrouter.service_tier'
    | 'openrouter.speed'
    | 'model'
    | 'base_url',
  value: string,
  options: {
    source?: EditableSettingSource
    /** Assign base_url to this provider without changing the active provider. */
    provider?: ProviderId | string
  } = {},
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
        ...endpointSettingsForProviderSwitch(currentSettings, provider),
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
    } else if (key === 'openai_transport') {
      if (trimmed !== 'chat-completions' && trimmed !== 'responses') {
        return {
          ok: false,
          message: 'openai_transport must be chat-completions or responses.',
        }
      }
      settings = { provider: { openaiTransport: trimmed } } as SettingsJson
    } else if (key === 'responses.store') {
      if (trimmed !== 'true' && trimmed !== 'false') {
        return { ok: false, message: 'responses.store must be true or false.' }
      }
      settings = { provider: { responses: { store: trimmed === 'true' } } } as SettingsJson
    } else if (key === 'responses.compact_threshold') {
      if (!/^\d+$/u.test(trimmed)) {
        return {
          ok: false,
          message: 'responses.compact_threshold must be an integer of at least 1000.',
        }
      }
      const compactThreshold = Number(trimmed)
      if (!Number.isSafeInteger(compactThreshold) || compactThreshold < 1_000) {
        return {
          ok: false,
          message: 'responses.compact_threshold must be an integer of at least 1000.',
        }
      }
      settings = { provider: { responses: { compactThreshold } } } as SettingsJson
    } else if (key === 'responses.tool_search') {
      if (trimmed !== 'off' && trimmed !== 'hosted') {
        return { ok: false, message: 'responses.tool_search must be off or hosted.' }
      }
      settings = { provider: { responses: { toolSearch: trimmed } } } as SettingsJson
    } else if (key === 'openrouter.routing') {
      if (!['auto', 'throughput', 'latency', 'price'].includes(trimmed)) {
        return {
          ok: false,
          message: 'openrouter.routing must be auto, throughput, latency, or price.',
        }
      }
      settings = {
        provider: { openrouter: { routing: trimmed as OpenRouterRoutingStrategy } },
      } as SettingsJson
    } else if (
      key === 'openrouter.allow_fallbacks' ||
      key === 'openrouter.require_parameters'
    ) {
      if (trimmed !== 'true' && trimmed !== 'false' && trimmed !== 'auto') {
        return { ok: false, message: `${key} must be true, false, or auto.` }
      }
      const field =
        key === 'openrouter.allow_fallbacks'
          ? 'allowFallbacks'
          : 'requireParameters'
      settings = {
        provider: {
          openrouter: {
            [field]: trimmed === 'auto' ? undefined : trimmed === 'true',
          },
        },
      } as SettingsJson
    } else if (
      key === 'openrouter.preferred_min_throughput' ||
      key === 'openrouter.preferred_max_latency'
    ) {
      const parsed = trimmed === 'auto' ? undefined : Number(trimmed)
      if (parsed !== undefined && (!Number.isFinite(parsed) || parsed <= 0)) {
        return { ok: false, message: `${key} must be a positive number or auto.` }
      }
      const field =
        key === 'openrouter.preferred_min_throughput'
          ? 'preferredMinThroughput'
          : 'preferredMaxLatency'
      settings = {
        provider: { openrouter: { [field]: parsed } },
      } as SettingsJson
    } else if (key === 'openrouter.service_tier') {
      if (!['auto', 'default', 'flex', 'priority', 'fast'].includes(trimmed)) {
        return {
          ok: false,
          message: 'openrouter.service_tier must be auto, default, flex, priority, or fast.',
        }
      }
      settings = {
        provider: {
          openrouter: {
            serviceTier: trimmed as NonNullable<OpenRouterSettings['serviceTier']>,
          },
        },
      } as SettingsJson
    } else if (key === 'openrouter.speed') {
      if (trimmed !== 'standard' && trimmed !== 'fast') {
        return {
          ok: false,
          message: 'openrouter.speed must be standard or fast.',
        }
      }
      settings = {
        provider: {
          openrouter: {
            speed: trimmed as NonNullable<OpenRouterSettings['speed']>,
          },
        },
      } as SettingsJson
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
      const currentSettings = getInitialSettings()
      const currentProvider =
        getActiveProviderSettings(currentSettings).active ?? DEFAULT_PROVIDER_ID
      const targetProvider = options.provider
        ? resolveProviderId(options.provider)
        : currentProvider
      if (!targetProvider) {
        return {
          ok: false,
          message: `Unknown provider "${options.provider}". Run: ur provider list`,
        }
      }
      if (getProviderDefinition(targetProvider).accessType === 'subscription') {
        return {
          ok: false,
          message: `Provider "${targetProvider}" is a vendor-managed subscription CLI and does not accept a base URL.`,
        }
      }
      const baseUrl = normalizeBaseUrl(trimmed)
      const configured = currentSettings.provider ?? {}
      const migratedLegacyBaseUrls: Partial<Record<ProviderId, string>> = {}
      if (configured.baseUrls === undefined && configured.baseUrl) {
        migratedLegacyBaseUrls[currentProvider] = configured.baseUrl
      }
      settings = {
        provider: {
          // Keep the legacy mirror tied to the active provider. Runtime
          // resolution uses baseUrls, but older readers still inspect baseUrl.
          ...(targetProvider === currentProvider ? { baseUrl } : {}),
          baseUrls: {
            ...migratedLegacyBaseUrls,
            [targetProvider]: baseUrl,
          },
        },
      } as SettingsJson
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
  const namedBaseUrlProvider =
    key === 'base_url'
      ? resolveProviderId(options.provider ?? getActiveProviderSettings(getInitialSettings()).active ?? DEFAULT_PROVIDER_ID)
      : undefined
  return {
    ok: true,
    message: `${
      key === 'base_url' && namedBaseUrlProvider
        ? `Set base_url for ${namedBaseUrlProvider} to ${savedValue}.`
        : `Set ${key} to ${savedValue}.`
    }${providerModelInvalidated ? ' Cleared incompatible model for the new provider; run /model to choose a scoped model.' : ''}`,
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
  if (kind === 'ollama') {
    return `${normalizeOllamaBaseUrl(baseUrl)}/api/tags`
  }
  const trimmed = baseUrl.replace(/\/$/, '')
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

const NVIDIA_HOSTED_API_HOST = 'integrate.api.nvidia.com'
const NVIDIA_FUNCTIONS_URL =
  'https://api.nvcf.nvidia.com/v2/nvcf/functions?visibility=authorized&visibility=public'

type NvidiaActiveFunctionInventory = {
  activeFunctionCount: number
  descriptors: string[]
}

function isNvidiaHostedApi(baseUrl: string): boolean {
  try {
    return new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase() === NVIDIA_HOSTED_API_HOST
  } catch {
    return false
  }
}

function normalizeNvidiaIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '')
}

function isNvidiaAgentModelCandidate(modelId: string): boolean {
  // NVIDIA's hosted `/v1/models` response mixes chat models with embeddings,
  // safety classifiers, parsers, translators, reward models, and detectors.
  // Those endpoints cannot drive UR's tool-calling agent loop and should not
  // be presented as selectable chat models.
  return !/(?:^|[/_.-])(?:calibration|deplot|detector|embed(?:ding|qa)?|guard|nemoguard|nemoretriever|nvclip|ocr|parse|rerank|retriever|reward|safety|translate)(?:$|[/_.-])/iu.test(
    modelId,
  )
}

function parseNvidiaActiveFunctionInventory(
  value: unknown,
): NvidiaActiveFunctionInventory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('NVIDIA account function inventory returned an invalid response.')
  }
  const functions = (value as { functions?: unknown }).functions
  if (!Array.isArray(functions)) {
    throw new Error('NVIDIA account function inventory omitted its functions list.')
  }
  const active = functions.filter(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    return String((entry as { status?: unknown }).status ?? '').toUpperCase() === 'ACTIVE'
  })
  const descriptors = active.flatMap(entry => {
    const record = entry as { name?: unknown; tags?: unknown }
    const values = [
      ...(typeof record.name === 'string' ? [record.name] : []),
      ...(Array.isArray(record.tags)
        ? record.tags.filter((tag): tag is string => typeof tag === 'string')
        : typeof record.tags === 'string'
          ? [record.tags]
          : []),
    ]
    return values.map(normalizeNvidiaIdentifier).filter(Boolean)
  })
  return {
    activeFunctionCount: active.length,
    descriptors: [...new Set(descriptors)],
  }
}

async function fetchNvidiaActiveFunctionInventory(
  fetchImpl: NonNullable<ProviderDoctorAdapters['fetch']>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<NvidiaActiveFunctionInventory> {
  let response: Response
  try {
    response = await fetchImpl(NVIDIA_FUNCTIONS_URL, {
      method: 'GET',
      signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (error) {
    throw new Error(
      `NVIDIA account function inventory is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new Error(
      `NVIDIA account function inventory returned HTTP ${response.status}.`,
    )
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('NVIDIA account function inventory returned malformed JSON.')
  }
  return parseNvidiaActiveFunctionInventory(body)
}

function filterNvidiaHostedModels(
  models: ProviderModelDefinition[],
  inventory: NvidiaActiveFunctionInventory,
): ProviderModelDefinition[] {
  if (inventory.activeFunctionCount === 0 || inventory.descriptors.length === 0) {
    return []
  }
  return models.flatMap(model => {
    if (!isNvidiaAgentModelCandidate(model.id)) return []
    const basename = model.id.split('/').at(-1) ?? model.id
    const normalizedModel = normalizeNvidiaIdentifier(basename)
    if (
      !normalizedModel ||
      !inventory.descriptors.some(descriptor => descriptor.includes(normalizedModel))
    ) {
      return []
    }
    return [{
      ...model,
      description: `${model.description} · active for connected NVIDIA account`,
    }]
  })
}

async function checkEndpoint(
  definition: ProviderDefinition,
  settings: ProviderSettings,
  adapters: ProviderDoctorAdapters,
  result: ProviderDoctorResult,
): Promise<void> {
  if (!definition.endpointKind) return
  // Same precedence as providerBaseUrl: the doctor must probe the host the
  // session is actually using, or it reports a healthy localhost while
  // requests go to the discovered machine.
  const baseUrl =
    (definition.id === 'ollama' ? getOllamaSessionOverride() : undefined) ??
    settings.baseUrl ??
    (definition.id === 'ollama' ? getOllamaBaseUrl() : definition.defaultBaseUrl)
  if (!baseUrl) {
    result.checks.push({
      name: 'base_url',
      status: 'fail',
      message: 'No base_url configured.',
    })
    addFailure(
      result,
      'missing base_url',
      `Run: ur config set base_url ${definition.id} <url>`,
    )
    return
  }
  // Probe the same candidate paths discovery uses, so the doctor reflects the
  // URL that actually yields models (e.g. `/v1/models` when base_url omits /v1).
  const candidates =
    definition.endpointKind === 'ollama'
      ? [endpointUrl(normalizeOllamaBaseUrl(baseUrl), 'ollama')]
      : openAiCompatibleModelUrls(baseUrl)
  const env = adapters.env ?? process.env
  let apiKey =
    definition.id === 'ollama'
      ? env.OLLAMA_API_KEY
      : definition.envKey
        ? env[definition.envKey]
        : undefined
  if (!apiKey && definition.envKey) {
    apiKey = await storedProviderApiKey(definition.id, env, adapters)
  }
  if (definition.requiresApiKey && !apiKey) {
    result.checks.push({
      name: 'api_key',
      status: 'fail',
      message: `${definition.envKey ?? 'Provider API key'} is not set and no stored key is available.`,
    })
    addFailure(
      result,
      'API key missing',
      `Connect once: ur connect ${definition.id}${definition.envKey ? ` (or set ${definition.envKey})` : ''}.`,
    )
    return
  }
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
  const fetchImpl = adapters.fetch ?? fetch
  let reachableUrl: string | undefined
  let modelsUrl: string | undefined
  let detectedModels: ProviderModelDefinition[] = []
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
      detectedModels = modelDefinitionsFromNames(definition.id, names, 'live')
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
      const authenticationFailure =
        (lastStatus === 401 || lastStatus === 403) && definition.envKey
      addFailure(
        result,
        `endpoint returned HTTP ${lastStatus}`,
        authenticationFailure
          ? `Add or replace this endpoint's key with: ur connect ${definition.id} (or set ${definition.envKey}).`
          : `Start the provider server or update base_url: ur config set base_url ${definition.id} ${baseUrl}`,
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
        `Start the provider server or update base_url: ur config set base_url ${definition.id} ${baseUrl}`,
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
  const verifiesNvidiaAccountFunctions =
    definition.id === 'nvidia-nim' && isNvidiaHostedApi(baseUrl)
  if (verifiesNvidiaAccountFunctions && modelsUrl && apiKey) {
    try {
      const inventory = await fetchNvidiaActiveFunctionInventory(
        fetchImpl,
        apiKey,
        AbortSignal.timeout(10_000),
      )
      detectedModels = filterNvidiaHostedModels(detectedModels, inventory)
      if (detectedModels.length === 0) {
        result.checks.push({
          name: 'account_models',
          status: 'fail',
          message: 'NVIDIA returned no active chat models for this account.',
        })
        addFailure(
          result,
          'NVIDIA account has no active chat models',
          'Confirm the key at build.nvidia.com, then reconnect with: ur connect nvidia-nim',
        )
      } else {
        result.checks.push({
          name: 'account_models',
          status: 'pass',
          message: `${detectedModels.length} account-active NVIDIA chat models are selectable.`,
        })
      }
    } catch (error) {
      result.checks.push({
        name: 'account_models',
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
      })
      addFailure(
        result,
        'NVIDIA account model inventory unavailable',
        'Reconnect the build.nvidia.com key with: ur connect nvidia-nim',
      )
    }
  }
  if (settings.model) {
    const modelDetected = detectedModels.some(model => model.id === settings.model)
    if (modelsUrl && !modelDetected) {
      result.checks.push({
        name: 'model',
        status: verifiesNvidiaAccountFunctions ? 'fail' : 'warn',
        message: verifiesNvidiaAccountFunctions
          ? `Model "${settings.model}" is not an account-active NVIDIA chat model.`
          : `Model "${settings.model}" was not found in the detectable model list.`,
      })
      if (verifiesNvidiaAccountFunctions) {
        addFailure(
          result,
          'selected NVIDIA NIM model is inactive',
          'Run /model, choose NVIDIA NIM, and select an account-active model.',
        )
      }
    } else if (modelsUrl) {
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
    definition.requiresApiKey === true ||
    (definition.credentialType === 'api-key' &&
      definition.endpointKind !== 'openai-compatible')
  let apiKey = definition.envKey ? env[definition.envKey] : undefined
  let keySource: 'env' | 'stored' = 'env'
  if (!apiKey && (!adapters.env || adapters.getApiKey)) {
    apiKey = await storedProviderApiKey(definition.id, env, adapters)
    if (apiKey) keySource = 'stored'
  }
  if (definition.envKey && requiresKey) {
    if (apiKey) {
      result.checks.push({
        name: 'api_key',
        status: 'pass',
        message: keySource === 'stored' ? 'Stored API key present (connected).' : `${definition.envKey} is present.`,
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
  if (definition.endpointKind) {
    await checkEndpoint(definition, settings, adapters, result)
    return
  }
  if (!apiKey || !baseUrl) return

  const request = apiModelsRequestForBase(definition.id, apiKey, baseUrl)
  try {
    const response = await (adapters.fetch ?? fetch)(request.url, {
      method: 'GET',
      headers: request.headers,
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      result.checks.push({
        name: 'endpoint',
        status: 'fail',
        message: `${request.url} returned HTTP ${response.status}.`,
      })
      addFailure(
        result,
        `endpoint returned HTTP ${response.status}`,
        `Check the API key or update base_url: ur config set base_url ${definition.id} ${baseUrl}`,
      )
      return
    }
    result.checks.push({
      name: 'endpoint',
      status: 'pass',
      message: `${request.url} is reachable.`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.checks.push({
      name: 'endpoint',
      status: 'fail',
      message: `${request.url} is not reachable.`,
    })
    addFailure(
      result,
      message,
      `Update base_url or start the configured gateway: ur config set base_url ${definition.id} ${baseUrl}`,
    )
  }
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
    message: `Recovery provider ${settings.fallback} is configured. UR-Nexus will not switch automatically; review the failure, then select it explicitly with: ur config set provider ${settings.fallback}`,
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
    baseUrl: providerBaseUrl(active, definition, allSettings),
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
    baseUrl: settingsForProvider.baseUrl ?? definition.defaultBaseUrl,
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
        return 'Ollama endpoint reachable'
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
    ...(result.baseUrl ? [`Base URL: ${result.baseUrl}`] : []),
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
  pricing?: 'free' | 'paid' | 'unknown'
  contextLength?: number
  outputTokenLimit?: number
  supportedParameters?: string[]
  capabilities?: Record<string, unknown>
  reasoning?: ModelReasoningCapabilities
  expirationDate?: number
  deprecated?: boolean
}

const EFFORT_LOW_MEDIUM_HIGH: ModelReasoningCapabilities = {
  supportedEfforts: ['low', 'medium', 'high'],
}
const EFFORT_LOW_MEDIUM_HIGH_XHIGH: ModelReasoningCapabilities = {
  supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
}
const EFFORT_LOW_MEDIUM_HIGH_MAX: ModelReasoningCapabilities = {
  supportedEfforts: ['low', 'medium', 'high', 'max'],
}
const EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX: ModelReasoningCapabilities = {
  supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
}
const OPENAI_GPT_56_EFFORTS: ModelReasoningCapabilities = {
  // OpenAI names the no-reasoning tier `none`; UR presents it as the existing
  // `minimal` selector and preserves the provider-authored wire value.
  supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  effortAliases: { minimal: 'none' },
}
const GEMINI_MINIMAL_TO_HIGH: ModelReasoningCapabilities = {
  supportedEfforts: ['minimal', 'low', 'medium', 'high'],
}
const NVIDIA_NONE_LOW_HIGH: ModelReasoningCapabilities = {
  supportedEfforts: ['none', 'low', 'high'],
  effortAliases: { minimal: 'none' },
  defaultEffort: 'high',
}
const NVIDIA_NONE_HIGH_MAX: ModelReasoningCapabilities = {
  supportedEfforts: ['none', 'high', 'max'],
  effortAliases: { minimal: 'none', ultra: 'max' },
  defaultEffort: 'high',
}
const NVIDIA_FULL_EFFORT_RANGE: ModelReasoningCapabilities = {
  supportedEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'max'],
  effortAliases: { ultra: 'max' },
  defaultEffort: 'high',
}

export const PROVIDER_MODELS: Record<ProviderId, ProviderModelDefinition[]> = {
  // Generic subscription entry. No models are listed because this build has no
  // independent subscription backend. External app bridges keep their own
  // scoped lists behind explicit opt-in.
  subscription: [],
  // OpenAI subscription CLI (codex) - uses Codex CLI subscription login
  'codex-cli': [
    { id: 'codex/gpt-5.6-sol', displayName: 'GPT-5.6 Sol (Codex CLI)', description: 'Flagship subscription model through official Codex CLI login', isDefault: true },
    { id: 'codex/gpt-5.6-terra', displayName: 'GPT-5.6 Terra (Codex CLI)', description: 'Balanced GPT-5.6 subscription model through official Codex CLI login' },
    { id: 'codex/gpt-5.6-luna', displayName: 'GPT-5.6 Luna (Codex CLI)', description: 'Efficient GPT-5.6 subscription model through official Codex CLI login' },
    { id: 'codex/gpt-5.5', displayName: 'GPT-5.5 (Codex CLI)', description: 'Previous-generation subscription model through official Codex CLI login' },
    { id: 'codex/gpt-5.4', displayName: 'GPT-5.4 (Codex CLI)', description: 'Subscription model through official Codex CLI login' },
    { id: 'codex/gpt-5.4-mini', displayName: 'GPT-5.4 Mini (Codex CLI)', description: 'Fast subscription model through official Codex CLI login' },
    { id: 'codex/gpt-4o', displayName: 'GPT-4o (Codex CLI)', description: 'Subscription model through official Codex CLI login' },
    { id: 'codex/gpt-4o-mini', displayName: 'GPT-4o Mini (Codex CLI)', description: 'Fast subscription model through official Codex CLI login' },
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
    { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', description: 'Flagship model for complex professional work', isDefault: true, contextLength: 1_050_000, outputTokenLimit: 128_000, reasoning: { ...OPENAI_GPT_56_EFFORTS, defaultEffort: 'medium' } },
    { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', description: 'Balances intelligence and cost', contextLength: 1_050_000, outputTokenLimit: 128_000, reasoning: { ...OPENAI_GPT_56_EFFORTS, defaultEffort: 'medium' } },
    { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', description: 'Optimized for cost-sensitive, high-volume workloads', contextLength: 1_050_000, outputTokenLimit: 128_000, reasoning: { ...OPENAI_GPT_56_EFFORTS, defaultEffort: 'medium' } },
    { id: 'gpt-5.5', displayName: 'GPT-5.5', description: 'Previous GPT-5 generation', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH, defaultEffort: 'medium' } },
    { id: 'gpt-5.4', displayName: 'GPT-5.4', description: 'Advanced reasoning and coding', reasoning: EFFORT_LOW_MEDIUM_HIGH_XHIGH },
    { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', description: 'Fast, efficient variant', reasoning: EFFORT_LOW_MEDIUM_HIGH_XHIGH },
    { id: 'gpt-4o', displayName: 'GPT-4o', description: 'Previous generation flagship' },
    { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', description: 'Fast GPT-4o variant' },
  ],
  // Anthropic API - direct API access with ANTHROPIC_API_KEY
  'anthropic-api': [
    { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', description: 'Balanced performance and speed', isDefault: true, reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'high' } },
    { id: 'claude-opus-5', displayName: 'Claude Opus 5', description: 'Frontier intelligence for coding and agentic work', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'high' } },
    { id: 'claude-fable-5', displayName: 'Claude Fable 5', description: 'Most capable Claude model for long-horizon work', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'high' } },
    { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', description: 'Most powerful Claude model', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'high' } },
    { id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7', description: 'High-end reasoning', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'high' } },
    { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', description: 'Advanced problem solving', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_MAX, defaultEffort: 'high' } },
    { id: 'claude-opus-4-5', displayName: 'Claude Opus 4.5', description: 'Previous Opus generation', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH, defaultEffort: 'high' } },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', description: 'Fast Sonnet variant', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_MAX, defaultEffort: 'high' } },
    { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', description: 'Previous Sonnet generation' },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', description: 'Fastest Claude model' },
  ],
  // Google Gemini API - direct API access with GEMINI_API_KEY
  'gemini-api': [
    { id: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', description: 'Latest agentic and multimodal Flash model', isDefault: true, reasoning: { ...EFFORT_LOW_MEDIUM_HIGH, defaultEffort: 'medium' } },
    { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', description: 'Agentic and multimodal Flash model', reasoning: { ...GEMINI_MINIMAL_TO_HIGH, defaultEffort: 'medium' } },
    { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', description: 'Previous Flash generation for agentic tasks', reasoning: { ...GEMINI_MINIMAL_TO_HIGH, defaultEffort: 'medium' } },
    { id: 'gemini-3.1-pro', displayName: 'Gemini 3.1 Pro', description: 'Advanced problem solving (preview)', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH, defaultEffort: 'high' } },
    { id: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite', description: 'Budget-friendly performance', reasoning: { ...GEMINI_MINIMAL_TO_HIGH, defaultEffort: 'minimal' } },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', description: 'Complex reasoning and coding', reasoning: EFFORT_LOW_MEDIUM_HIGH },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', description: 'Low-latency tasks', reasoning: EFFORT_LOW_MEDIUM_HIGH },
    { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', description: 'Fastest Gemini model', reasoning: EFFORT_LOW_MEDIUM_HIGH },
  ],
  // OpenRouter - multi-provider router (openai/*, anthropic/*, google/*, etc.)
  'openrouter': [
    { id: 'openai/gpt-5.6-sol', displayName: 'GPT-5.6 Sol', description: 'OpenAI GPT-5.6 Sol via OpenRouter', isDefault: true, reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'medium' } },
    { id: 'openai/gpt-5.6-terra', displayName: 'GPT-5.6 Terra', description: 'OpenAI GPT-5.6 Terra via OpenRouter', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'medium' } },
    { id: 'openai/gpt-5.6-luna', displayName: 'GPT-5.6 Luna', description: 'OpenAI GPT-5.6 Luna via OpenRouter', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'medium' } },
    { id: 'openai/gpt-5.5', displayName: 'GPT-5.5', description: 'Previous OpenAI GPT-5 generation via OpenRouter', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH, defaultEffort: 'medium' } },
    { id: 'openai/gpt-5.4', displayName: 'GPT-5.4', description: 'OpenAI GPT-5.4 via OpenRouter' },
    { id: 'openai/gpt-4o', displayName: 'GPT-4o', description: 'OpenAI GPT-4o via OpenRouter' },
    { id: 'anthropic/claude-sonnet-5', displayName: 'Claude Sonnet 5', description: 'Anthropic Claude via OpenRouter' },
    { id: 'anthropic/claude-opus-5', displayName: 'Claude Opus 5', description: 'Anthropic Claude via OpenRouter', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'high' } },
    { id: 'anthropic/claude-fable-5', displayName: 'Claude Fable 5', description: 'Anthropic Claude via OpenRouter', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH_XHIGH_MAX, defaultEffort: 'high' } },
    { id: 'anthropic/claude-opus-4-8', displayName: 'Claude Opus 4.8', description: 'Anthropic Claude via OpenRouter' },
    { id: 'google/gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', description: 'Google Gemini via OpenRouter', reasoning: { ...EFFORT_LOW_MEDIUM_HIGH, defaultEffort: 'medium' } },
    { id: 'google/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', description: 'Google Gemini via OpenRouter', reasoning: { ...GEMINI_MINIMAL_TO_HIGH, defaultEffort: 'medium' } },
    { id: 'google/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', description: 'Google Gemini via OpenRouter' },
    { id: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', description: 'Google Gemini via OpenRouter' },
  ],
  // NVIDIA NIM is live-discovery only. These hidden entries are capability
  // overlays for model contracts NVIDIA documents explicitly; they never
  // become an offline model catalogue or imply account availability.
  'nvidia-nim': [
    { id: 'openai/gpt-oss-20b', displayName: 'openai/gpt-oss-20b', description: 'NVIDIA-documented reasoning contract', isDynamic: true, reasoning: { supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium' } },
    { id: 'openai/gpt-oss-120b', displayName: 'openai/gpt-oss-120b', description: 'NVIDIA-documented reasoning contract', isDynamic: true, reasoning: { supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium' } },
    { id: 'nvidia/nemotron-3-super-120b-a12b', displayName: 'nvidia/nemotron-3-super-120b-a12b', description: 'NVIDIA-documented reasoning contract', isDynamic: true, reasoning: NVIDIA_NONE_LOW_HIGH },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b', displayName: 'nvidia/nemotron-3-ultra-550b-a55b', description: 'NVIDIA-documented reasoning contract', isDynamic: true, reasoning: NVIDIA_NONE_LOW_HIGH },
    { id: 'deepseek-ai/deepseek-v4-flash', displayName: 'deepseek-ai/deepseek-v4-flash', description: 'NVIDIA-documented reasoning contract', isDynamic: true, reasoning: NVIDIA_NONE_HIGH_MAX },
    { id: 'deepseek-ai/deepseek-v4-flash-0731', displayName: 'deepseek-ai/deepseek-v4-flash-0731', description: 'NVIDIA-documented reasoning contract', isDynamic: true, reasoning: NVIDIA_NONE_HIGH_MAX },
    { id: 'meta/muse-glimmer-30b', displayName: 'meta/muse-glimmer-30b', description: 'NVIDIA-documented reasoning contract', isDynamic: true, reasoning: NVIDIA_FULL_EFFORT_RANGE },
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
  // Unsloth Studio - authenticated user-run OpenAI-compatible server
  'unsloth': [
    { id: 'dynamic', displayName: 'Discovered Models', description: 'Models discovered from Unsloth Studio', isDynamic: true, isDefault: true },
  ],
}

const cachedModelsByProvider = new Map<string, ProviderModelDefinition[]>()
/** Wall-clock time each cache entry was written, so age can be reported. */
const cachedModelsWrittenAt = new Map<string, number>()
/** Runtime-rejected models stay hidden until the user explicitly refreshes. */
const unavailableModelsByEndpoint = new Map<string, Set<string>>()
/** Collapses concurrent identical discovery requests onto one fetch. */
const modelDiscoveryCoalescer = new RequestCoalescer<ProviderModelDefinition[]>()

/** Provider catalogue requests are short control-plane calls, not model runs. */
export const MODEL_DISCOVERY_TIMEOUT_MS = 15_000

export function clearProviderModelCacheForTests(): void {
  cachedModelsByProvider.clear()
  cachedModelsWrittenAt.clear()
  unavailableModelsByEndpoint.clear()
  modelDiscoveryCoalescer.clear()
}

/** Invalidate every cached endpoint for a provider after reconnect/disconnect. */
export function clearProviderModelCache(providerId: ProviderId | string): void {
  const provider = resolveProviderId(providerId)
  if (!provider) return
  const prefix = `${provider}@`
  modelDiscoveryCoalescer.cancel(provider)
  modelDiscoveryCoalescer.cancelPrefix(prefix)
  for (const key of cachedModelsByProvider.keys()) {
    if (key === provider || key.startsWith(prefix)) {
      cachedModelsByProvider.delete(key)
      cachedModelsWrittenAt.delete(key)
    }
  }
  for (const key of unavailableModelsByEndpoint.keys()) {
    if (key === provider || key.startsWith(prefix)) {
      unavailableModelsByEndpoint.delete(key)
    }
  }
}

/** Number of discovery requests currently in flight. Exposed for tests. */
export function inFlightModelDiscoveryCount(): number {
  return modelDiscoveryCoalescer.size
}

function withoutRuntimeUnavailableModels(
  key: string,
  models: ProviderModelDefinition[],
): ProviderModelDefinition[] {
  const unavailable = unavailableModelsByEndpoint.get(key)
  if (!unavailable?.size) return models
  return models.filter(model => !unavailable.has(model.id.toLowerCase()))
}

function rememberModels(key: string, models: ProviderModelDefinition[]): void {
  cachedModelsByProvider.set(key, withoutRuntimeUnavailableModels(key, models))
  cachedModelsWrittenAt.set(key, Date.now())
}

/**
 * Hide a model that a compatible runtime has definitively rejected. This is
 * endpoint-scoped: switching to another saved server cannot inherit the
 * failure. Clearing/refreshing the provider catalog intentionally retries it.
 */
export function markProviderModelUnavailable(
  providerId: ProviderId | string,
  modelId: string,
  baseUrl?: string,
): void {
  const provider = resolveProviderId(providerId)
  const normalizedModel = modelId.trim().toLowerCase()
  if (!provider || !normalizedModel) return
  const keys = baseUrl
    ? [providerEndpointCacheKey(provider, baseUrl)]
    : [...cachedModelsByProvider.keys()].filter(
        key => key === provider || key.startsWith(`${provider}@`),
      )
  for (const key of keys) {
    const unavailable = unavailableModelsByEndpoint.get(key) ?? new Set<string>()
    unavailable.add(normalizedModel)
    unavailableModelsByEndpoint.set(key, unavailable)
    const cached = cachedModelsByProvider.get(key)
    if (cached) {
      cachedModelsByProvider.set(
        key,
        cached.filter(model => model.id.toLowerCase() !== normalizedModel),
      )
    }
    modelDiscoveryCoalescer.cancel(key)
  }
}

/** Age of a cache entry in ms, or undefined when nothing is cached. */
function cachedModelsAgeMs(key: string): number | undefined {
  const writtenAt = cachedModelsWrittenAt.get(key)
  return writtenAt === undefined ? undefined : Date.now() - writtenAt
}

function providerBaseUrl(
  provider: ProviderId,
  definition: ProviderDefinition,
  settings: SettingsJson,
): string | undefined {
  // A host picked this session with --discover-ollama must outrank a persisted
  // provider.baseUrl. Checking settings first meant the discovered host never
  // reached model discovery for anyone who had ever run `ur config set
  // base_url`, so /model kept listing localhost models with no indication why.
  if (provider === 'ollama') {
    const sessionHost = getOllamaSessionOverride()
    if (sessionHost) {
      return sessionHost
    }
  }
  const configuredBaseUrl = getScopedProviderBaseUrl(provider, settings)
  if (configuredBaseUrl) {
    return provider === 'ollama'
      ? normalizeOllamaBaseUrl(configuredBaseUrl)
      : configuredBaseUrl
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

function modelDefinitionsFromDiscovered(
  models: DiscoveredModel[],
  provider?: ProviderId,
): ProviderModelDefinition[] {
  const staticModels = provider ? PROVIDER_MODELS[provider] ?? [] : []
  return models.map(model => {
    const curated = staticModels.find(
      entry => entry.id.toLowerCase() === model.id.toLowerCase(),
    )
    const reasoning =
      model.reasoning || curated?.reasoning
        ? {
            ...(curated?.reasoning ?? {}),
            ...(model.reasoning ?? {}),
            ...(curated?.reasoning?.effortAliases || model.reasoning?.effortAliases
              ? {
                  effortAliases: {
                    ...(curated?.reasoning?.effortAliases ?? {}),
                    ...(model.reasoning?.effortAliases ?? {}),
                  },
                }
              : {}),
          }
        : undefined
    return {
      id: model.id,
      displayName: model.displayName,
      description: model.description,
      pricing: model.pricing,
      ...(model.contextLength ? { contextLength: model.contextLength } : {}),
      ...(model.outputTokenLimit ? { outputTokenLimit: model.outputTokenLimit } : {}),
      ...(model.supportedParameters ? { supportedParameters: model.supportedParameters } : {}),
      ...(model.capabilities ? { capabilities: model.capabilities } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(model.expirationDate ? { expirationDate: model.expirationDate } : {}),
      ...(model.deprecated ? { deprecated: true } : {}),
    }
  })
}

function providerModelCacheKey(
  provider: ProviderId,
  settings: SettingsJson = getInitialSettings(),
): string {
  const definition = getProviderDefinition(provider)
  let endpoint = providerBaseUrl(provider, definition, settings)
  if (
    definition.accessType === 'api' &&
    definition.modelDiscoveryType === 'live' &&
    !definition.endpointKind
  ) {
    endpoint = apiModelsRequest(provider, '', settings).url
  }
  if (!endpoint) return provider
  return providerEndpointCacheKey(provider, endpoint)
}

function providerEndpointCacheKey(
  provider: ProviderId,
  endpoint: string,
): string {
  try {
    const url = new URL(normalizeBaseUrl(endpoint))
    url.hash = ''
    url.username = ''
    url.password = ''
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    const canonical = url.toString().replace(/\/$/, '')
    return `${provider}@${canonical}`
  } catch {
    return `${provider}@${endpoint.trim().replace(/\/+$/, '')}`
  }
}

function getCachedProviderModels(
  provider: ProviderId,
  settings: SettingsJson = getInitialSettings(),
): ProviderModelDefinition[] {
  return cachedModelsByProvider.get(providerModelCacheKey(provider, settings)) ?? []
}

function providerCapabilityModelId(provider: ProviderId, model: string): string {
  const normalized = model.trim().toLowerCase()
  return provider === 'openrouter'
    ? normalized.replace(/:(?:nitro|floor|exacto)$/u, '')
    : normalized
}

/**
 * Context window a provider reported for a model, in tokens.
 *
 * Discovery already captures this — OpenRouter's `context_length`, and the
 * equivalent field on other providers — and the model picker shows it. It was
 * never fed back into the context-window resolution, which fell through to a
 * flat 200K for every non-first-party model. On a model with a smaller window
 * that meant autocompact never fired before the provider rejected the request;
 * on a larger one it meant compacting long before it was needed.
 *
 * Reads the discovery cache only. No network, no await — the callers are on
 * the per-turn path.
 */
export function getProviderContextLengthForModel(
  model: string,
  provider: ProviderId | string =
    getInitialSettings().provider?.active ?? DEFAULT_PROVIDER_ID,
  settings: SettingsJson = getInitialSettings(),
): number | undefined {
  const providerId = resolveProviderId(provider)
  if (!providerId) return undefined
  const wanted = providerCapabilityModelId(providerId, model)
  if (!wanted) return undefined
  const known = [
    ...getCachedProviderModels(providerId, settings),
    ...(PROVIDER_MODELS[providerId] ?? []),
  ]
  const match =
    known.find(entry => entry.id.toLowerCase() === wanted) ??
    known.find(entry => wanted.includes(entry.id.toLowerCase()))
  const length = match?.contextLength
  return typeof length === 'number' && Number.isFinite(length) && length > 0
    ? Math.floor(length)
    : undefined
}

/**
 * Maximum completion size reported by the provider for a model, in tokens.
 *
 * OpenRouter and other live catalogues already expose this metadata. Applying
 * it to request validation prevents UR from asking a model for more output
 * than the provider accepts. Reads the in-memory discovery cache only.
 */
export function getProviderOutputTokenLimitForModel(
  model: string,
  provider: ProviderId | string = getRuntimeProviderId(),
  settings: SettingsJson = getInitialSettings(),
): number | undefined {
  const providerId = resolveProviderId(provider)
  if (!providerId) return undefined
  const wanted = providerCapabilityModelId(providerId, model)
  if (!wanted) return undefined
  const known = [
    ...getCachedProviderModels(providerId, settings),
    ...(PROVIDER_MODELS[providerId] ?? []),
  ]
  const match =
    known.find(entry => entry.id.toLowerCase() === wanted) ??
    known.find(entry => wanted.includes(entry.id.toLowerCase()))
  const limit = match?.outputTokenLimit
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : undefined
}

/**
 * Return live reasoning metadata for the active provider/model without doing
 * network I/O. OpenRouter publishes this in `/models`; keeping it beside the
 * cached model definition lets effort selection and request shaping share one
 * authoritative capability record.
 */
export function getProviderReasoningCapabilitiesForModel(
  model: string,
  provider: ProviderId | string = getRuntimeProviderId(),
  settings: SettingsJson = getInitialSettings(),
): ModelReasoningCapabilities | undefined {
  const providerId = resolveProviderId(provider)
  if (!providerId) return undefined
  const wanted = providerCapabilityModelId(providerId, model)
  if (!wanted) return undefined
  const known = [
    ...getCachedProviderModels(providerId, settings),
    ...(PROVIDER_MODELS[providerId] ?? []),
  ]
  // Capability request shaping must use an exact model identity. Substring
  // inheritance can silently attach one model's reasoning contract to a new
  // or vendor-prefixed model whose provider never advertised it.
  const match = known.find(entry => entry.id.toLowerCase() === wanted)
  return match?.reasoning
}

function providerPropsUrl(baseUrl: string, model: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl))
  url.hash = ''
  url.search = ''
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(
    /\/(?:v\d+(?:beta)?|api\/v\d+)\/(?:chat\/completions|models|responses|props)$/i,
    '',
  )
  path = path.replace(/\/(?:v\d+(?:beta)?|api\/v\d+)$/i, '')
  path = path.replace(/\/(?:chat\/completions|models|props)$/i, '')
  url.pathname = `${path}/props`
  url.searchParams.set('model', model)
  return url.toString()
}

function vllmServerInfoUrl(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl))
  url.hash = ''
  url.search = ''
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(
    /\/(?:v\d+(?:beta)?|api\/v\d+)\/(?:chat\/completions|models|responses)$/i,
    '',
  )
  path = path.replace(/\/(?:v\d+(?:beta)?|api\/v\d+)$/i, '')
  path = path.replace(/\/(?:chat\/completions|models|responses)$/i, '')
  url.pathname = `${path}/server_info`
  url.searchParams.set('config_format', 'json')
  return url.toString()
}

function vllmServerAdvertisesReasoning(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    for (const [key, nested] of Object.entries(current)) {
      const normalizedKey = key.replace(/-/g, '_').toLowerCase()
      if (
        normalizedKey === 'reasoning_parser' &&
        typeof nested === 'string' &&
        nested.trim() &&
        !/^(?:none|null|false)$/i.test(nested.trim())
      ) {
        return true
      }
      if (normalizedKey === 'enable_reasoning' && nested === true) {
        return true
      }
      if (nested && typeof nested === 'object') pending.push(nested)
    }
  }
  return false
}

function reasoningCapabilitiesFromVllmServerInfo(
  value: unknown,
): ModelReasoningCapabilities | undefined {
  if (!vllmServerAdvertisesReasoning(value)) return undefined
  // vLLM's current Chat Completions contract accepts none/low/medium/high and
  // injects enable_thinking for the graded values. The server-info parser flag
  // proves that the running endpoint was configured to return reasoning for
  // its served model; no inference request is used for discovery.
  return {
    supportsThinking: true,
    supportedEfforts: ['none', 'low', 'medium', 'high'],
    effortAliases: { minimal: 'none' },
  }
}

function ollamaShowUrl(baseUrl: string): string {
  const url = new URL(endpointUrl(baseUrl, 'ollama'))
  url.pathname = url.pathname.replace(/\/tags\/?$/i, '/show')
  return url.toString()
}

function reasoningCapabilitiesFromOllamaShow(
  model: string,
  value: unknown,
): ModelReasoningCapabilities | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const root = value as Record<string, unknown>
  const capabilities = Array.isArray(root.capabilities)
    ? root.capabilities
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim().toLowerCase())
    : undefined

  const details =
    root.details && typeof root.details === 'object'
      ? (root.details as Record<string, unknown>)
      : {}
  const modelInfo =
    root.model_info && typeof root.model_info === 'object'
      ? (root.model_info as Record<string, unknown>)
      : {}
  const explicit =
    parseModelReasoningCapabilities(root.reasoning) ??
    parseModelReasoningCapabilities(modelInfo.reasoning) ??
    parseModelReasoningCapabilities(details.reasoning) ??
    parseModelReasoningCapabilities(root)
  if (explicit) {
    return capabilities
      ? {
          supportsThinking: capabilities.includes('thinking'),
          ...explicit,
        }
      : explicit
  }

  if (!capabilities) return undefined
  if (!capabilities.includes('thinking')) {
    return { supportsThinking: false, supportedEfforts: [] }
  }

  const identity = [model, details.family, details.parent_model]
    .filter((entry): entry is string => typeof entry === 'string')
    .join(' ')

  // A generic Ollama `thinking` capability does not identify whether this
  // model accepts booleans, graded strings, or both. GPT-OSS has a documented
  // low/medium/high contract. Never turn the generic flag or a model-name guess
  // into other graded levels; those require explicit provider metadata above.
  if (/gpt[-_]?oss/i.test(identity)) {
    return {
      supportsThinking: true,
      supportedEfforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
    }
  }
  return { supportsThinking: true }
}

function reasoningCapabilitiesFromProps(
  value: unknown,
): ModelReasoningCapabilities | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const root = value as Record<string, unknown>
  const explicit =
    parseModelReasoningCapabilities(root.reasoning) ??
    parseModelReasoningCapabilities(
      root.meta && typeof root.meta === 'object'
        ? (root.meta as Record<string, unknown>).reasoning
        : undefined,
    ) ??
    parseModelReasoningCapabilities({
      supported_efforts: root.supported_efforts,
      default_effort: root.default_effort,
    })
  if (explicit) return explicit

  const caps =
    root.chat_template_caps && typeof root.chat_template_caps === 'object'
      ? (root.chat_template_caps as Record<string, unknown>)
      : undefined
  if (caps?.supports_reasoning_effort === true) {
    // `/props` proves that the template consumes an effort value, but current
    // llama.cpp does not report which values the template accepts. Keep the
    // model thinking-capable without inventing a selectable ladder.
    return { supportsThinking: true }
  }
  if (caps?.supports_reasoning_effort === false) {
    const supportsThinking =
      caps.supports_reasoning === true ||
      caps.supports_thinking === true ||
      caps.supports_preserve_reasoning === true
    return supportsThinking
      ? { supportsThinking: true, supportedEfforts: [] }
      : { supportedEfforts: [] }
  }
  return undefined
}

function rememberProviderModelReasoning(
  provider: ProviderId,
  model: string,
  reasoning: ModelReasoningCapabilities,
  settings: SettingsJson,
): void {
  const key = providerModelCacheKey(provider, settings)
  const existing = cachedModelsByProvider.get(key) ?? []
  const wanted = model.trim().toLowerCase()
  let found = false
  const updated = existing.map(entry => {
    if (entry.id.toLowerCase() !== wanted) return entry
    found = true
    return { ...entry, reasoning }
  })
  if (!found) {
    updated.push({
      id: model,
      displayName: model,
      description: `Discovered from ${getProviderDefinition(provider).displayName}`,
      reasoning,
    })
  }
  rememberModels(key, updated)
}

/**
 * Load the focused model's provider-authored reasoning contract. llama.cpp
 * exposes template support through /props, Ollama exposes thinking through
 * /api/show, and vLLM exposes its configured reasoning parser through
 * /server_info. These checks are lazy and never launch inference.
 */
export async function ensureProviderReasoningCapabilitiesForModel(
  providerId: ProviderId | string,
  model: string,
  options: {
    settings?: SettingsJson
    adapters?: ProviderDoctorAdapters
    signal?: AbortSignal
  } = {},
): Promise<ModelReasoningCapabilities | undefined> {
  const provider = resolveProviderId(providerId)
  if (!provider) return undefined
  const settings = options.settings ?? getInitialSettings()
  const cached = getProviderReasoningCapabilitiesForModel(
    model,
    provider,
    settings,
  )
  if (cached !== undefined) return cached

  if (
    provider !== 'llama.cpp' &&
    provider !== 'ollama' &&
    provider !== 'vllm'
  ) {
    await ensureProviderModelsFresh(provider, options)
    return getProviderReasoningCapabilitiesForModel(model, provider, settings)
  }

  const definition = getProviderDefinition(provider)
  const baseUrl = providerBaseUrl(provider, definition, settings)
  if (!baseUrl) return undefined
  const env = options.adapters?.env ?? process.env
  const fetchImpl = options.adapters?.fetch ?? fetch
  let apiKey =
    provider === 'ollama'
      ? env.OLLAMA_API_KEY
      : definition.envKey
        ? env[definition.envKey]
        : undefined
  if (!apiKey) {
    apiKey = await storedProviderApiKey(provider, env, options.adapters)
  }
  const capabilityUrl =
    provider === 'ollama'
      ? ollamaShowUrl(baseUrl)
      : provider === 'vllm'
        ? vllmServerInfoUrl(baseUrl)
        : providerPropsUrl(baseUrl, model)
  const response = await fetchImpl(
    capabilityUrl,
    {
      method: provider === 'ollama' ? 'POST' : 'GET',
      signal: options.signal,
      ...(provider === 'ollama'
        ? {
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ model }),
          }
        : apiKey
          ? { headers: { Authorization: `Bearer ${apiKey}` } }
          : {}),
    },
  )
  if (!response.ok) {
    throw new Error(
      `${provider === 'ollama' ? 'Ollama /api/show' : provider === 'vllm' ? 'vLLM /server_info' : 'llama.cpp /props'} returned HTTP ${response.status}.`,
    )
  }
  const body = await response.json().catch(() => null)
  const reasoning =
    provider === 'ollama'
      ? reasoningCapabilitiesFromOllamaShow(model, body)
      : provider === 'vllm'
        ? reasoningCapabilitiesFromVllmServerInfo(body)
        : reasoningCapabilitiesFromProps(body)
  if (reasoning) {
    rememberProviderModelReasoning(provider, model, reasoning, settings)
  }
  return reasoning
}

export function cacheProviderModelsForProvider(
  providerId: ProviderId | string,
  models: string[] | ProviderModelDefinition[],
  settings: SettingsJson = getInitialSettings(),
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
    rememberModels(providerModelCacheKey(provider, settings), definitions)
  }
}

function staticModelsForProvider(provider: ProviderId): ProviderModelDefinition[] {
  return (PROVIDER_MODELS[provider] ?? []).filter(model => !model.isDynamic)
}

async function withModelDiscoveryTimeout<T>(
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const relayAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) relayAbort()
  else signal?.addEventListener('abort', relayAbort, { once: true })

  let rejectTimeout: ((error: Error) => void) | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject
  })
  let rejectCancelled: ((error: Error) => void) | undefined
  const cancelledPromise = signal
    ? new Promise<never>((_resolve, reject) => {
        rejectCancelled = reject
      })
    : undefined
  const rejectOnAbort = () =>
    rejectCancelled?.(
      signal?.reason instanceof Error ? signal.reason : new Error('Model discovery cancelled.'),
    )
  if (signal?.aborted) rejectOnAbort()
  else signal?.addEventListener('abort', rejectOnAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    rejectTimeout?.(
      new Error(`Model discovery timed out after ${MODEL_DISCOVERY_TIMEOUT_MS}ms.`),
    )
  }, MODEL_DISCOVERY_TIMEOUT_MS)

  try {
    return await Promise.race([
      operation(controller.signal),
      timeoutPromise,
      ...(cancelledPromise ? [cancelledPromise] : []),
    ])
  } catch (error) {
    if (timedOut) {
      throw new Error(`Model discovery timed out after ${MODEL_DISCOVERY_TIMEOUT_MS}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', relayAbort)
    signal?.removeEventListener('abort', rejectOnAbort)
  }
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
    apiKey = await storedProviderApiKey(provider, env, options.adapters)
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
    const discovered = parseDiscoveredModels(
      body,
      getProviderDefinition(provider).displayName,
    )
    if (discovered.length > 0) {
      const models = modelDefinitionsFromDiscovered(discovered, provider)
      if (provider === 'nvidia-nim' && isNvidiaHostedApi(baseUrl)) {
        if (!apiKey) {
          throw new Error('NVIDIA hosted model discovery requires an API key.')
        }
        const inventory = await fetchNvidiaActiveFunctionInventory(
          fetchImpl,
          apiKey,
          options.signal,
        )
        return filterNvidiaHostedModels(models, inventory)
      }
      return models
    }
  }
  if (!reachedOk && lastError) {
    throw lastError
  }
  return []
}

function apiModelsRequestForBase(
  provider: ProviderId,
  apiKey: string,
  configuredBase: string | undefined,
): { url: string; headers: Record<string, string> } {
  const providerDefault = getProviderDefinition(provider).defaultBaseUrl
  const modelsUrl = (baseUrl: string, version: string): string => {
    const url = new URL(normalizeBaseUrl(baseUrl))
    url.hash = ''
    url.search = ''
    let path = url.pathname.replace(/\/+$/, '')
    path = path.replace(/\/(chat\/completions|messages|models|responses)$/i, '')
    if (!/\/v\d+(?:beta)?$/i.test(path) && !/\/api\/v\d+$/i.test(path)) {
      path = `${path}/${version}`
    }
    url.pathname = `${path}/models`
    return url.toString().replace(/\/$/, '')
  }
  switch (provider) {
    case 'anthropic-api':
      return {
        url: modelsUrl(configuredBase ?? providerDefault!, 'v1'),
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      }
    case 'gemini-api':
      return {
        url: `${normalizeGeminiBaseUrl(configuredBase ?? providerDefault)}/models`,
        headers: { 'x-goog-api-key': apiKey },
      }
    case 'openrouter':
      return {
        url: modelsUrl(configuredBase ?? providerDefault!, 'v1'),
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    default:
      return {
        url: modelsUrl(configuredBase ?? providerDefault!, 'v1'),
        headers: { Authorization: `Bearer ${apiKey}` },
      }
  }
}

function apiModelsRequest(
  provider: ProviderId,
  apiKey: string,
  settings: SettingsJson,
): { url: string; headers: Record<string, string> } {
  return apiModelsRequestForBase(
    provider,
    apiKey,
    getScopedProviderBaseUrl(provider, settings),
  )
}

function apiModelEntries(provider: ProviderId, body: unknown): Array<Record<string, unknown>> {
  const root = (body ?? {}) as Record<string, unknown>
  if (provider === 'gemini-api') {
    const models = Array.isArray(root.models) ? (root.models as Array<Record<string, unknown>>) : []
    return models
      .filter(model => {
        const methods = model.supportedGenerationMethods
        return !Array.isArray(methods) || methods.includes('generateContent')
      })
      .flatMap(model => {
        const id = typeof model.name === 'string' ? model.name.replace(/^models\//, '') : ''
        if (!id) return []
        return [{
          ...model,
          id,
          display_name: typeof model.displayName === 'string' ? model.displayName : id,
        }]
      })
  }
  return Array.isArray(root.data)
    ? (root.data as Array<Record<string, unknown>>).filter(
        entry => entry && typeof entry === 'object',
      )
    : []
}

function nextApiModelsPage(
  provider: ProviderId,
  body: unknown,
): { parameter: string; token: string } | undefined {
  const root = (body ?? {}) as Record<string, unknown>
  if (provider === 'gemini-api') {
    const token = typeof root.nextPageToken === 'string' ? root.nextPageToken.trim() : ''
    return token ? { parameter: 'pageToken', token } : undefined
  }
  if (provider === 'anthropic-api' && root.has_more === true) {
    const token = typeof root.last_id === 'string' ? root.last_id.trim() : ''
    if (!token) {
      throw new Error('Anthropic model pagination returned has_more without last_id.')
    }
    return { parameter: 'after_id', token }
  }
  return undefined
}

function apiModelsPageUrl(
  baseUrl: string,
  provider: ProviderId,
  next?: { parameter: string; token: string },
): string {
  const url = new URL(baseUrl)
  if (provider === 'gemini-api') url.searchParams.set('pageSize', '1000')
  if (provider === 'anthropic-api') url.searchParams.set('limit', '1000')
  if (next) url.searchParams.set(next.parameter, next.token)
  return url.toString()
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
    apiKey = await storedProviderApiKey(provider, env, options.adapters)
  }
  if (!apiKey) {
    throw new Error(`Not connected: run \`ur connect ${provider}\` to add an API key.`)
  }
  const { url, headers } = apiModelsRequest(
    provider,
    apiKey,
    options.settings ?? getInitialSettings(),
  )
  const fetchImpl = options.adapters?.fetch ?? fetch
  const entries: Array<Record<string, unknown>> = []
  const seenPageTokens = new Set<string>()
  let next: { parameter: string; token: string } | undefined
  do {
    const pageUrl = apiModelsPageUrl(url, provider, next)
    const response = await fetchImpl(pageUrl, {
      method: 'GET',
      signal: options.signal,
      headers,
    })
    if (!response.ok) {
      throw new Error(`${pageUrl} returned HTTP ${response.status}.`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw new Error(
        `${pageUrl} returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    entries.push(...apiModelEntries(provider, body))
    next = nextApiModelsPage(provider, body)
    if (next) {
      const pageKey = `${next.parameter}:${next.token}`
      if (seenPageTokens.has(pageKey)) {
        throw new Error(`Model pagination repeated token "${next.token}" for ${provider}.`)
      }
      seenPageTokens.add(pageKey)
    }
  } while (next)

  const providerLabel = getProviderDefinition(provider).displayName
  return modelDefinitionsFromDiscovered(
    parseDiscoveredModels({ data: entries }, providerLabel),
    provider,
  )
}

export async function listModelsForProviderWithSource(
  providerId: ProviderId | string,
  options: {
    settings?: SettingsJson
    adapters?: ProviderDoctorAdapters
    signal?: AbortSignal
    /** Require a newly fetched catalog and never substitute stale entries. */
    freshOnly?: boolean
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

  const cacheSettings = options.settings ?? getInitialSettings()
  // Capture before the request. If the session endpoint changes while a
  // discovery fetch is in flight, its response still belongs to the endpoint
  // that initiated it, never the newly selected host.
  const cacheKey = providerModelCacheKey(provider, cacheSettings)
  try {
    // Concurrent selections of the same provider share one request instead of
    // issuing a second whose response can land out of order.
    const liveModels = await modelDiscoveryCoalescer.run(
      cacheKey,
      sharedSignal =>
        withModelDiscoveryTimeout(sharedSignal, boundedSignal =>
          discoverLiveModelsForProvider(provider, {
            ...options,
            signal: boundedSignal,
          }),
        ),
      options.signal,
    )
    const selectableLiveModels = withoutRuntimeUnavailableModels(cacheKey, liveModels)
    if (selectableLiveModels.length > 0) {
      rememberModels(cacheKey, selectableLiveModels)
      return {
        provider,
        models: selectableLiveModels,
        source: 'live',
      }
    }
    if (options.freshOnly) {
      return {
        provider,
        models: [],
        source: 'unavailable',
        warning: `Live model discovery for "${provider}" returned no models. No cached catalog was shown.`,
      }
    }
    const cachedModels = cachedModelsByProvider.get(cacheKey) ?? []
    if (cachedModels.length > 0) {
      const age = describeCacheAge(cachedModelsAgeMs(cacheKey) ?? 0)
      return {
        provider,
        models: cachedModels,
        source: 'cache',
        warning: `Live model discovery for "${provider}" returned no models. Showing cached ${provider} models only${age ? ` (${age})` : ''}.`,
      }
    }
    const staticModels = staticModelsForProvider(provider)
    return {
      provider,
      models: staticModels,
      source: staticModels.length > 0 ? 'static' : 'unavailable',
      warning: `Live model discovery for "${provider}" returned no models.`,
    }
  } catch (error) {
    if (options.freshOnly) {
      return {
        provider,
        models: [],
        source: 'unavailable',
        warning: `Live model discovery for "${provider}" failed: ${error instanceof Error ? error.message : String(error)}. No cached catalog was shown.`,
      }
    }
    const cachedModels = cachedModelsByProvider.get(cacheKey) ?? []
    if (cachedModels.length > 0) {
      const age = describeCacheAge(cachedModelsAgeMs(cacheKey) ?? 0)
      return {
        provider,
        models: cachedModels,
        source: 'cache',
        warning: `Live model discovery for "${provider}" failed: ${error instanceof Error ? error.message : String(error)}. Showing cached ${provider} models only${age ? ` (${age})` : ''}.`,
      }
    }
    const staticModels = staticModelsForProvider(provider)
    return {
      provider,
      models: staticModels,
      source: staticModels.length > 0 ? 'static' : 'unavailable',
      warning: `Live model discovery for "${provider}" failed: ${error instanceof Error ? error.message : String(error)}.`,
    }
  }
}

/**
 * Runtime freshness gate. A matching endpoint cache inside the short TTL is
 * reused and labelled as cache; after the TTL one caller refreshes while
 * concurrent callers share that endpoint-scoped request.
 */
export async function ensureProviderModelsFresh(
  providerId: ProviderId | string,
  options: {
    settings?: SettingsJson
    adapters?: ProviderDoctorAdapters
    signal?: AbortSignal
    force?: boolean
  } = {},
): Promise<ProviderModelDiscoveryResult> {
  const provider = resolveProviderId(providerId)
  if (!provider) return listModelsForProviderWithSource(providerId, options)
  const definition = getProviderDefinition(provider)
  if (definition.modelDiscoveryType === 'static') {
    return listModelsForProviderWithSource(provider, options)
  }
  const settings = options.settings ?? getInitialSettings()
  const key = providerModelCacheKey(provider, settings)
  const cached = cachedModelsByProvider.get(key) ?? []
  const age = cachedModelsAgeMs(key)
  if (!options.force && cached.length > 0 && age !== undefined && age <= MODEL_CACHE_TTL_MS) {
    return {
      provider,
      models: cached,
      source: 'cache',
      warning: `Using ${provider} models refreshed ${Math.max(0, Math.floor(age / 1000))}s ago from the matching endpoint.`,
    }
  }
  return listModelsForProviderWithSource(provider, {
    settings,
    adapters: options.adapters,
    signal: options.signal,
  })
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
  const visibleModels = validModels.slice(0, 8)
  const hiddenCount = validModels.length - visibleModels.length
  const validList = validModels.length > 0
    ? `${visibleModels.join(', ')}${hiddenCount > 0 ? `, … and ${hiddenCount} more` : ''}`
    : '(no models discovered)'
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
    settings?: SettingsJson
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

  const suppliedDefinitions = (options.availableModels ?? []).map(model =>
    typeof model === 'string'
      ? { id: model, displayName: model, description: '' }
      : model,
  )
  const cachedDefinitions = getCachedProviderModels(provider, options.settings)
  const staticDefinitions = staticModelsForProvider(provider)
  const isAgentCapable = (model: ProviderModelDefinition): boolean =>
    model.supportedParameters === undefined || model.supportedParameters.includes('tools')
  const suppliedModels = suppliedDefinitions.filter(isAgentCapable).map(model => model.id)
  const cachedModels = cachedDefinitions.filter(isAgentCapable).map(model => model.id)
  const staticModelIds = staticDefinitions.filter(isAgentCapable).map(model => model.id)
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

  const comparableModelId = providerCapabilityModelId(provider, modelId)
  const selectedDefinition = [
    ...cachedDefinitions,
    ...suppliedDefinitions,
    ...staticDefinitions,
  ].find(model => model.id.toLowerCase() === comparableModelId)
  if (
    selectedDefinition?.supportedParameters !== undefined &&
    !selectedDefinition.supportedParameters.includes('tools')
  ) {
    const defaultModel = getDefaultModelForProvider(provider)
    return {
      valid: false,
      error: `Model "${modelId}" is listed by provider "${provider}" but does not advertise tool calling, which this agent runtime requires. Run /model and choose a model labelled for tool calling.`,
      validModels: validModelIds,
      suggestedModel: defaultModel,
    }
  }

  if (
    validModelIds.some(
      validModelId => validModelId.toLowerCase() === comparableModelId,
    )
  ) {
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
  const currentSettings = getInitialSettings()
  const result = updateSettingsForSource(source, {
    provider: {
      active: provider,
      model: modelId,
      ...endpointSettingsForProviderSwitch(currentSettings, provider),
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
