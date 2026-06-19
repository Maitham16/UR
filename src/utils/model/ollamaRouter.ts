// Adaptive model routing for the local Ollama backend. Pure + testable:
// pick a strong coder model for the main loop and a small/fast model for the
// light "small-fast" tier, based on which models are actually installed.

export type OllamaModelTiers = {
  all: string[]
  coder: string[]
  fast: string[]
}

const CODER_PATTERN =
  /(coder|codellama|codestral|starcoder|deepseek-coder|granite-?code|codegemma|codeqwen|stable-?code|code-)/i

const FAST_NAME_PATTERN =
  /(tinyllama|smollm|\bphi-?\d?|gemma2?:2b|qwen2\.5:(?:0\.5|1\.5|3)b|:mini|:small)/i

const FAST_MAX_PARAMS_B = 4

const COMPLEX_SIGNALS =
  /```|\b(implement|refactor|debug|fix|bug|error|stack ?trace|optimi[sz]e|algorithm|migrat|compile|build|test|deploy|architecture|class|function|async|await|import|export)\b|\.(ts|tsx|js|jsx|py|go|rs|java|cpp|cc|c|h|hpp|rb|php|cs|swift|kt|sql)\b/i

const SIMPLE_SIGNALS =
  /^(hi|hello|hey|thanks|thank you|yes|no|ok|okay|what is|who is|when |where |explain |define |summar|tl;?dr)/i

export function parseModelParamsB(name: string): number | undefined {
  const lower = name.toLowerCase()
  const moe = lower.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*b/)
  if (moe) return Number(moe[2])
  const single = lower.match(/(\d+(?:\.\d+)?)\s*b(?![a-z])/)
  return single ? Number(single[1]) : undefined
}

export function categorizeOllamaModels(names: string[]): OllamaModelTiers {
  const all = names
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    .map(n => n.trim())
  const coder = all.filter(n => CODER_PATTERN.test(n))
  const fast = all.filter(n => {
    const params = parseModelParamsB(n)
    return (
      FAST_NAME_PATTERN.test(n) ||
      (params !== undefined && params <= FAST_MAX_PARAMS_B)
    )
  })
  return { all, coder, fast }
}

export function pickBestCoderModel(
  names: string[],
  fallback?: string,
): string | undefined {
  const { all, coder } = categorizeOllamaModels(names)
  if (all.length === 0) return fallback
  const pool = coder.length > 0 ? coder : all
  return (
    [...pool].sort(
      (a, b) => paramsOrZero(b) - paramsOrZero(a) || a.localeCompare(b),
    )[0] ?? fallback
  )
}

export function pickSmallFastModel(
  names: string[],
  fallback?: string,
): string | undefined {
  const { all, fast } = categorizeOllamaModels(names)
  if (all.length === 0) return fallback
  const pool = fast.length > 0 ? fast : all
  return (
    [...pool].sort(
      (a, b) => paramsOrInfinity(a) - paramsOrInfinity(b) || a.localeCompare(b),
    )[0] ?? fallback
  )
}

export function classifyTaskComplexity(prompt: string): 'simple' | 'complex' {
  const text = (prompt ?? '').trim()
  if (text.length === 0) return 'simple'
  if (text.length > 280) return 'complex'
  if (COMPLEX_SIGNALS.test(text)) return 'complex'
  if (text.length < 160 && SIMPLE_SIGNALS.test(text)) return 'simple'
  return 'complex'
}

export function selectOllamaModelForPrompt(input: {
  prompt: string
  names: string[]
  defaultModel: string
  enabled?: boolean
}): string {
  const { prompt, names, defaultModel, enabled = true } = input
  if (!enabled || names.length === 0) return defaultModel
  return classifyTaskComplexity(prompt) === 'simple'
    ? (pickSmallFastModel(names, defaultModel) ?? defaultModel)
    : (pickBestCoderModel(names, defaultModel) ?? defaultModel)
}

export function recommendedCoderModelToPull(
  names: string[],
): string | undefined {
  return categorizeOllamaModels(names).coder.length > 0
    ? undefined
    : 'qwen2.5-coder'
}

export function isOllamaAutoRouteEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.UR_OLLAMA_AUTO_ROUTE
  if (raw === undefined || raw.trim() === '') return true
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase())
}

function paramsOrZero(name: string): number {
  return parseModelParamsB(name) ?? 0
}

function paramsOrInfinity(name: string): number {
  return parseModelParamsB(name) ?? Number.POSITIVE_INFINITY
}
