import type { Message } from '../../types/message.js'
import type { ProviderId } from '../../services/providers/providerRegistry.js'
import { MIN_CHAT_NUM_CTX } from './ollamaTuning.js'

/**
 * Local and user-hosted runtimes pay the full memory and prefill cost of every
 * reserved token. Cloud APIs can schedule that cost across a fleet; a local
 * GPU cannot. Keep their default reservation realistic while still allowing
 * an explicit UR_CODE_MAX_OUTPUT_TOKENS override.
 */
const CONSERVATIVE_OUTPUT_PROVIDERS = new Set<ProviderId>([
  'ollama',
  'lmstudio',
  'llama.cpp',
  'vllm',
  'openai-compatible',
])

// Exact greetings need no repository tools on any backend. Keeping this list
// explicit makes additions fail visibly when a new provider is introduced.
const LIGHTWEIGHT_CHAT_PROVIDERS = new Set<ProviderId>([
  'ollama',
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
])

export const LIGHTWEIGHT_CHAT_MAX_OUTPUT_TOKENS = 1_024
export const LIGHTWEIGHT_CHAT_MIN_CONTEXT_TOKENS = MIN_CHAT_NUM_CTX
export const SELF_HOSTED_DEFAULT_MAX_OUTPUT_TOKENS = 4_096

export const LIGHTWEIGHT_CHAT_SYSTEM_PROMPT =
  'You are UR, a precise and professional AI assistant. Respond directly, clearly, and concisely. Do not claim to have inspected files or used tools in this lightweight chat turn.'

export type ProviderRequestProfile =
  | { mode: 'agent' }
  | {
      mode: 'lightweight-chat'
      maxOutputTokens: number
      minContextTokens: number
      systemPrompt: string
    }

export function usesConservativeOutputReservation(
  provider: ProviderId,
): boolean {
  return CONSERVATIVE_OUTPUT_PROVIDERS.has(provider)
}

/**
 * A full coding-agent prompt is necessary for repository work, but wasteful
 * for a fresh greeting. This deliberately recognizes only prompts that cannot
 * require a file, tool, or conversation-history lookup. Ambiguous requests
 * stay on the complete agent path.
 */
export function getProviderRequestProfile(input: {
  provider: ProviderId
  querySource: string
  messages: Message[]
}): ProviderRequestProfile {
  if (
    !LIGHTWEIGHT_CHAT_PROVIDERS.has(input.provider) ||
    !(
      input.querySource.startsWith('repl_main_thread') ||
      input.querySource === 'sdk'
    )
  ) {
    return { mode: 'agent' }
  }

  // Never remove tool declarations or history after an assistant has replied.
  if (input.messages.some(message => message.type === 'assistant')) {
    return { mode: 'agent' }
  }

  const visibleUserMessages = input.messages.filter(
    message =>
      message.type === 'user' &&
      !message.isMeta &&
      !message.isCompactSummary &&
      !message.toolUseResult,
  )
  if (visibleUserMessages.length !== 1) {
    return { mode: 'agent' }
  }

  const prompt = textOnlyContent(visibleUserMessages[0])
  if (prompt === undefined || !isTrivialGreeting(prompt)) {
    return { mode: 'agent' }
  }

  return {
    mode: 'lightweight-chat',
    maxOutputTokens: LIGHTWEIGHT_CHAT_MAX_OUTPUT_TOKENS,
    minContextTokens: LIGHTWEIGHT_CHAT_MIN_CONTEXT_TOKENS,
    systemPrompt: LIGHTWEIGHT_CHAT_SYSTEM_PROMPT,
  }
}

function textOnlyContent(message: Message | undefined): string | undefined {
  const content = message?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content) || content.length === 0) return undefined
  if (
    content.some(
      block =>
        !block ||
        typeof block !== 'object' ||
        block.type !== 'text' ||
        typeof block.text !== 'string',
    )
  ) {
    return undefined
  }
  return content
    .map(block => block.text)
    .join('\n')
    .trim()
}

function isTrivialGreeting(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase()
  return /^(?:hi|hello|hey|hiya|greetings|good (?:morning|afternoon|evening)|thanks|thank you|ok|okay)[!.?,\s]*$/.test(
    normalized,
  )
}
