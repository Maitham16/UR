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

export type DiscoveredModel = {
  id: string
  /** Provider-supplied human name, falling back to the id. */
  displayName: string
  description: string
  pricing: ModelPricingTier
  contextLength?: number
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
  const dimensions = ['prompt', 'completion']
  const values: number[] = []
  for (const key of dimensions) {
    const raw = entries[key]
    if (raw === undefined || raw === null) {
      return 'unknown'
    }
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
  const contextLength = asCount(raw.context_length) ?? asCount(raw.contextLength)
  const humanName = asString(raw.name)
  const deprecated =
    raw.deprecated === true || /deprecated/i.test(asString(raw.description) ?? '')

  const parts = [
    pricing === 'free' ? 'free' : pricing === 'paid' ? 'paid' : null,
    deprecated ? 'deprecated' : null,
  ].filter(Boolean)

  return {
    id,
    // The full id is what the user must be able to read and copy, so it is
    // always shown; the human name is supplementary.
    displayName: humanName && humanName !== id ? `${id}  (${humanName})` : id,
    description: `${providerLabel}${parts.length ? ` · ${parts.join(' · ')}` : ''}${formatContext(contextLength)}`,
    pricing,
    ...(contextLength ? { contextLength } : {}),
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
  private readonly inFlight = new Map<string, Promise<T>>()

  run(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key)
    if (existing) {
      return existing
    }
    const promise = factory().finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  get size(): number {
    return this.inFlight.size
  }

  clear(): void {
    this.inFlight.clear()
  }
}
