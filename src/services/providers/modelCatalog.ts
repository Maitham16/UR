/**
 * Presentation and freshness rules for discovered provider model lists.
 *
 * Discovery itself lives in providerRegistry; this module owns three things it
 * previously lacked:
 *
 *  1. Metadata. `/models` responses carry a human name, a context length and
 *     pricing, all of which were discarded in favour of the raw id. OpenRouter
 *     in particular rotates which models are free, and that is only visible in
 *     `pricing`, so it has to be read per refresh rather than assumed.
 *  2. Ordering. Ids sorted lexically interleave free and paid variants of the
 *     same family; the list is grouped so the free tier is findable.
 *  3. Freshness. A cache entry has an age, and a list served from cache is
 *     labelled as such rather than presented as current.
 *
 * Sources:
 *  - https://openrouter.ai/docs/api-reference/list-available-models
 *  - https://platform.openai.com/docs/api-reference/models/list
 */

export type ModelPricingTier = 'free' | 'paid' | 'unknown'

export type ModelReasoningCapabilities = {
  /** Explicit boolean reasoning/thinking support, independent of graded effort. */
  supportsThinking?: boolean
  /**
   * Provider-advertised effort values. `null` means the gateway accepts every
   * normalized effort value; `undefined` means it did not advertise effort
   * selection at all.
   */
  supportedEfforts?: string[] | null
  /**
   * Optional provider-authored selector-to-wire aliases. For example, a
   * provider may explicitly advertise `ultra` as an alias for its canonical
   * `deep` wire value. Established beyond-high values (`max` and `xhigh`) are
   * also presented through UR's Ultra ceiling selector without changing the
   * provider wire value; arbitrary names still require an explicit alias.
   */
  effortAliases?: Record<string, string>
  defaultEffort?: string
  defaultEnabled?: boolean
  mandatory?: boolean
  supportsMaxTokens?: boolean
}

export type DiscoveredModel = {
  id: string
  /** Provider-supplied human name, falling back to the id. */
  displayName: string
  description: string
  pricing: ModelPricingTier
  contextLength?: number
  outputTokenLimit?: number
  supportedParameters?: string[]
  capabilities?: Record<string, unknown>
  reasoning?: ModelReasoningCapabilities
  expirationDate?: number
  deprecated?: boolean
}

/** How long a cached model list is treated as usable. */
export const MODEL_CACHE_TTL_MS = 5 * 60 * 1000

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Normalize OpenRouter's per-model `reasoning` discovery block. */
export function parseModelReasoningCapabilities(
  value: unknown,
): ModelReasoningCapabilities | undefined {
  if (!isRecord(value)) return undefined

  const rawSupportedEfforts =
    value.supported_efforts !== undefined
      ? value.supported_efforts
      : value.supportedEfforts
        ?? value.allowed_options
  const supportedEfforts =
    rawSupportedEfforts === null
      ? null
      : Array.isArray(rawSupportedEfforts)
        ? Array.from(
            new Set(
              rawSupportedEfforts
                .filter((entry): entry is string => typeof entry === 'string')
                .map(entry => entry.trim().toLowerCase())
                .filter(Boolean),
            ),
          )
        : undefined
  const defaultEffort = asString(
    value.default_effort !== undefined
      ? value.default_effort
      : value.defaultEffort ??
        (rawSupportedEfforts !== undefined ? value.default : undefined),
  )?.toLowerCase()
  const rawAliases = isRecord(value.effort_aliases)
    ? value.effort_aliases
    : isRecord(value.effortAliases)
      ? value.effortAliases
      : undefined
  const effortAliases = rawAliases
    ? Object.fromEntries(
        Object.entries(rawAliases).flatMap(([selector, wireValue]) => {
          const normalizedSelector = selector.trim().toLowerCase()
          const normalizedWireValue = asString(wireValue)?.toLowerCase()
          return normalizedSelector && normalizedWireValue
            ? [[normalizedSelector, normalizedWireValue]]
            : []
        }),
      )
    : undefined
  const defaultEnabled =
    typeof value.default_enabled === 'boolean'
      ? value.default_enabled
      : typeof value.defaultEnabled === 'boolean'
        ? value.defaultEnabled
      : undefined
  const mandatory =
    typeof value.mandatory === 'boolean' ? value.mandatory : undefined
  const supportsMaxTokens =
    typeof value.supports_max_tokens === 'boolean'
      ? value.supports_max_tokens
      : typeof value.supportsMaxTokens === 'boolean'
        ? value.supportsMaxTokens
      : undefined
  const supportsThinking =
    typeof value.supports_thinking === 'boolean'
      ? value.supports_thinking
      : typeof value.supportsThinking === 'boolean'
        ? value.supportsThinking
        : undefined

  if (
    supportsThinking === undefined &&
    supportedEfforts === undefined &&
    (effortAliases === undefined || Object.keys(effortAliases).length === 0) &&
    defaultEffort === undefined &&
    defaultEnabled === undefined &&
    mandatory === undefined &&
    supportsMaxTokens === undefined
  ) {
    return undefined
  }

  return {
    ...(supportsThinking !== undefined ? { supportsThinking } : {}),
    ...(supportedEfforts !== undefined ? { supportedEfforts } : {}),
    ...(effortAliases && Object.keys(effortAliases).length > 0
      ? { effortAliases }
      : {}),
    ...(defaultEffort !== undefined ? { defaultEffort } : {}),
    ...(defaultEnabled !== undefined ? { defaultEnabled } : {}),
    ...(mandatory !== undefined ? { mandatory } : {}),
    ...(supportsMaxTokens !== undefined ? { supportsMaxTokens } : {}),
  }
}

function asEpochSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric)
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000)
  }
  return undefined
}

/**
 * Pricing fields arrive as decimal strings ("0", "0.0000015"). A model counts
 * as free only when every priced dimension is explicitly zero — an absent
 * pricing block means unknown, never free.
 */
export function pricingTierFromOpenRouter(pricing: unknown): ModelPricingTier {
  if (!pricing || typeof pricing !== 'object') {
    return 'unknown'
  }
  const entries = pricing as Record<string, unknown>
  if (entries.prompt === undefined || entries.completion === undefined) {
    return 'unknown'
  }
  const values: number[] = []
  for (const raw of Object.values(entries)) {
    if (raw === undefined || raw === null || raw === '') return 'unknown'
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
    if (!Number.isFinite(parsed)) {
      return 'unknown'
    }
    values.push(parsed)
  }
  return values.every(value => value === 0) ? 'free' : 'paid'
}

/**
 * A model id may also advertise its tier via the `:free` variant suffix.
 * Pricing wins when present; the suffix is the fallback.
 */
export function pricingTierFromId(id: string): ModelPricingTier {
  return /:free$/i.test(id) ? 'free' : 'unknown'
}

function formatContext(contextLength: number | undefined): string {
  if (!contextLength) return ''
  if (contextLength >= 1000) {
    return ` · ${Math.round(contextLength / 1000)}K ctx`
  }
  return ` · ${contextLength} ctx`
}

/**
 * Build a display entry from one `/models` element. Handles the OpenRouter
 * shape (name/pricing/context_length) and degrades cleanly for providers that
 * return only an id.
 */
export function toDiscoveredModel(entry: unknown, providerLabel: string): DiscoveredModel | null {
  if (typeof entry === 'string') {
    const id = entry.trim()
    if (!id) return null
    return {
      id,
      displayName: id,
      description: `Discovered from ${providerLabel}`,
      pricing: pricingTierFromId(id),
    }
  }
  if (!entry || typeof entry !== 'object') {
    return null
  }
  const raw = entry as Record<string, unknown>
  const id = asString(raw.id) ?? asString(raw.name) ?? asString(raw.model)
  if (!id) return null

  const fromPricing = pricingTierFromOpenRouter(raw.pricing)
  const pricing = fromPricing === 'unknown' ? pricingTierFromId(id) : fromPricing
  const contextLength =
    asCount(raw.context_length) ??
    asCount(raw.contextLength) ??
    asCount(raw.max_input_tokens) ??
    asCount(raw.inputTokenLimit)
  const outputTokenLimit = asCount(raw.max_output_tokens) ?? asCount(raw.outputTokenLimit)
  const humanName = asString(raw.display_name) ?? asString(raw.displayName) ?? asString(raw.name)
  const supportedParameters = Array.isArray(raw.supported_parameters)
    ? raw.supported_parameters.filter((value): value is string => typeof value === 'string')
    : Array.isArray(raw.supportedGenerationMethods)
      ? raw.supportedGenerationMethods.filter((value): value is string => typeof value === 'string')
      : undefined
  const capabilities = isRecord(raw.capabilities) ? raw.capabilities : undefined
  const parsedReasoning =
    parseModelReasoningCapabilities(raw.reasoning) ??
    parseModelReasoningCapabilities(
      capabilities && isRecord(capabilities.reasoning)
        ? capabilities.reasoning
        : undefined,
    ) ??
    parseModelReasoningCapabilities(raw)
  const advertisesReasoning = supportedParameters?.some(parameter =>
    /^(?:reasoning|reasoning_effort|thinking)$/iu.test(parameter.trim()),
  )
  const reasoning = parsedReasoning ??
    (advertisesReasoning ? { supportsThinking: true } : undefined)
  const expirationDate = asEpochSeconds(raw.expiration_date)
  const deprecated =
    raw.deprecated === true ||
    (expirationDate !== undefined && expirationDate <= Math.floor(Date.now() / 1000)) ||
    /deprecated/i.test(asString(raw.description) ?? '')
  const expires =
    expirationDate !== undefined && !deprecated
      ? `expires ${new Date(expirationDate * 1000).toISOString().slice(0, 10)}`
      : null
  const lacksTools =
    supportedParameters !== undefined && !supportedParameters.includes('tools')

  const parts = [
    pricing === 'free' ? 'free' : pricing === 'paid' ? 'paid' : null,
    deprecated ? 'deprecated' : null,
    expires,
    lacksTools ? 'no tool calling' : null,
  ].filter(Boolean)

  return {
    id,
    // The full id is what the user must be able to read and copy, so it is
    // always shown; the human name is supplementary.
    displayName: humanName && humanName !== id ? `${id}  (${humanName})` : id,
    description: `${providerLabel}${parts.length ? ` · ${parts.join(' · ')}` : ''}${formatContext(contextLength)}`,
    pricing,
    ...(contextLength ? { contextLength } : {}),
    ...(outputTokenLimit ? { outputTokenLimit } : {}),
    ...(supportedParameters ? { supportedParameters } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(expirationDate ? { expirationDate } : {}),
    ...(deprecated ? { deprecated: true } : {}),
  }
}

/**
 * Deterministic ordering: usable before deprecated, free before paid (the
 * reason someone opens this list on OpenRouter), then by id so families stay
 * adjacent.
 */
export function orderModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const rank = (m: DiscoveredModel): number => {
    if (m.deprecated) return 3
    if (m.pricing === 'free') return 0
    if (m.pricing === 'unknown') return 1
    return 2
  }
  return [...models].sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    return a.id.localeCompare(b.id)
  })
}

/**
 * Drop duplicate ids that a provider may return across paginated or merged
 * catalogues, keeping the first (richest) occurrence.
 */
export function dedupeModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>()
  const out: DiscoveredModel[] = []
  for (const model of models) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

export function parseDiscoveredModels(body: unknown, providerLabel: string): DiscoveredModel[] {
  const root = (body ?? {}) as Record<string, unknown>
  const list = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : Array.isArray(body)
        ? (body as unknown[])
        : []
  const parsed = list
    .map(entry => toDiscoveredModel(entry, providerLabel))
    .filter((m): m is DiscoveredModel => m !== null)
  return orderModels(dedupeModels(parsed))
}

/**
 * Human label for a cached list's age, so cached data is never presented as
 * current. Returns null when the entry is still inside the TTL.
 */
export function describeCacheAge(ageMs: number, ttlMs = MODEL_CACHE_TTL_MS): string | null {
  if (!Number.isFinite(ageMs) || ageMs < 0) return null
  if (ageMs <= ttlMs) return null
  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 60) {
    return `cached ${Math.max(1, minutes)}m ago`
  }
  const hours = Math.floor(minutes / 60)
  return `cached ${hours}h ago`
}

/**
 * Collapses concurrent identical discovery requests onto one in-flight
 * promise. Selecting a provider twice in quick succession — or a refresh
 * landing while the first fetch is open — previously issued a second request
 * whose response could also arrive out of order.
 */
export class RequestCoalescer<T> {
  private readonly inFlight = new Map<
    string,
    {
      promise: Promise<T>
      controller: AbortController
      subscribers: number
      hasUncancelledSubscriber: boolean
    }
  >()

  run(
    key: string,
    factory: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let entry = this.inFlight.get(key)
    if (!entry) {
      const controller = new AbortController()
      const next: {
        promise: Promise<T>
        controller: AbortController
        subscribers: number
        hasUncancelledSubscriber: boolean
      } = {
        controller,
        subscribers: 0,
        hasUncancelledSubscriber: false,
        promise: Promise.resolve(undefined as T),
      }
      next.promise = Promise.resolve()
        .then(() => factory(controller.signal))
        .finally(() => {
          if (this.inFlight.get(key) === next) this.inFlight.delete(key)
        })
      this.inFlight.set(key, next)
      entry = next
    }

    if (!signal) {
      entry.hasUncancelledSubscriber = true
      return entry.promise
    }
    if (signal.aborted) {
      return Promise.reject(
        signal.reason instanceof Error ? signal.reason : new Error('Request cancelled.'),
      )
    }

    entry.subscribers++
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = () => {
        if (settled) return false
        settled = true
        signal.removeEventListener('abort', onAbort)
        entry!.subscribers--
        if (
          entry!.subscribers === 0 &&
          !entry!.hasUncancelledSubscriber &&
          this.inFlight.get(key) === entry
        ) {
          entry!.controller.abort()
        }
        return true
      }
      const onAbort = () => {
        if (!finish()) return
        reject(signal.reason instanceof Error ? signal.reason : new Error('Request cancelled.'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      entry!.promise.then(
        value => {
          if (finish()) resolve(value)
        },
        error => {
          if (finish()) reject(error)
        },
      )
    })
  }

  get size(): number {
    return this.inFlight.size
  }

  cancel(key: string): void {
    const entry = this.inFlight.get(key)
    if (!entry) return
    entry.controller.abort(new Error('Request invalidated.'))
    this.inFlight.delete(key)
  }

  cancelPrefix(prefix: string): void {
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) this.cancel(key)
    }
  }

  clear(): void {
    for (const entry of this.inFlight.values()) entry.controller.abort()
    this.inFlight.clear()
  }
}
