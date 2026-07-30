// Per-model context sizing and keep-alive tuning for the local Ollama backend.
// Pure and side-effect free so it can be unit tested with injected env.

export const MIN_AGENT_NUM_CTX = 32768
export const DEFAULT_OLLAMA_KEEP_ALIVE = '30m'

// Coarse num_ctx buckets. Bucketing keeps num_ctx stable across turns so Ollama
// does not reallocate its KV cache (and lose the warm model) every request.
const NUM_CTX_BUCKETS = [32768, 49152, 65536, 98304, 131072, 196608, 262144]

const OUTPUT_HEADROOM_TOKENS = 4096

type NumCtxInput = {
  modelContextLength?: number
  estimatedPromptTokens?: number
  maxTokens?: number
  override?: number
  minCtx?: number
}

export function computeOllamaNumCtx(input: NumCtxInput): number | undefined {
  const {
    modelContextLength,
    estimatedPromptTokens = 0,
    maxTokens = 0,
    override,
    minCtx = MIN_AGENT_NUM_CTX,
  } = input

  const cap = (n: number): number =>
    modelContextLength && modelContextLength > 0
      ? Math.min(n, modelContextLength)
      : n

  if (override !== undefined) {
    // explicit override wins; detected context is unreliable for cloud models
    return override > 0 ? override : undefined
  }

  const headroom = maxTokens > 0 ? maxTokens : OUTPUT_HEADROOM_TOKENS
  const desired = Math.max(minCtx, estimatedPromptTokens + headroom)
  return cap(bucketize(desired))
}

export type ContextPressure = {
  level: 'ok' | 'tight' | 'overflow'
  message?: string
}

/**
 * Ollama silently drops the *front* of an oversized prompt rather than
 * erroring. The front is the system prompt, so the first thing lost is the
 * instruction set — which is why an overflowing session stops producing task
 * lists and starts looking incompetent, with nothing in the output to say why.
 * Both numbers needed to detect this are already computed per request; they
 * were just never compared.
 */
export function describeContextPressure(input: {
  estimatedPromptTokens: number
  numCtx?: number
  modelContextLength?: number
  model: string
}): ContextPressure {
  const { estimatedPromptTokens, numCtx, modelContextLength, model } = input
  const effective = numCtx ?? modelContextLength
  if (!effective || effective <= 0 || estimatedPromptTokens <= 0) {
    return { level: 'ok' }
  }

  if (estimatedPromptTokens >= effective) {
    return {
      level: 'overflow',
      message:
        `This request is about ${fmt(estimatedPromptTokens)} tokens but ${model} ` +
        `is running with a ${fmt(effective)}-token context. Ollama discards the ` +
        `oldest tokens instead of failing, so the system prompt and earliest ` +
        `turns are being dropped and the model is answering without them. ` +
        `Use /compact, start a new session, pick a model with a larger context, ` +
        `or raise UR_OLLAMA_NUM_CTX if the model supports more.`,
    }
  }

  // Past ~85% the remaining room is mostly consumed by the reply itself.
  if (estimatedPromptTokens >= effective * 0.85) {
    return {
      level: 'tight',
      message:
        `This request is using about ${fmt(estimatedPromptTokens)} of ${model}'s ` +
        `${fmt(effective)}-token context. Once it is full, Ollama drops the ` +
        `oldest tokens — the system prompt first. /compact will free room.`,
    }
  }

  return { level: 'ok' }
}

function fmt(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

function bucketize(n: number): number {
  for (const bucket of NUM_CTX_BUCKETS) {
    if (bucket >= n) return bucket
  }
  return n
}

export function getOllamaNumCtxOverride(
  env: Record<string, string | undefined> = process.env,
): number | undefined {
  const raw = env.UR_OLLAMA_NUM_CTX
  if (raw === undefined || raw.trim() === '') return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function getOllamaKeepAlive(
  env: Record<string, string | undefined> = process.env,
): string | number | undefined {
  const raw = env.UR_OLLAMA_KEEP_ALIVE
  if (raw === undefined || raw.trim() === '') return DEFAULT_OLLAMA_KEEP_ALIVE
  const trimmed = raw.trim()
  const asNumber = Number(trimmed)
  return Number.isFinite(asNumber) ? asNumber : trimmed
}
