const DEFAULT_COMPACT_MODEL_LENGTH = 30

/**
 * Keep provider model IDs intact for requests while presenting their useful
 * leaf name in space-constrained terminal chrome.
 */
export function compactModelDisplayName(
  modelId: string,
  maxLength = DEFAULT_COMPACT_MODEL_LENGTH,
): string {
  const trimmed = modelId.trim()
  const leaf = trimmed.split('/').filter(Boolean).at(-1) ?? trimmed
  const limit = Number.isFinite(maxLength)
    ? Math.max(2, Math.floor(maxLength))
    : DEFAULT_COMPACT_MODEL_LENGTH
  if (leaf.length <= limit) return leaf
  return `${leaf.slice(0, limit - 1)}…`
}

type PresentableModel = {
  id: string
  displayName: string
}

/**
 * OpenRouter's full IDs remain the option values, but compact labels prevent
 * the catalogue from becoming wider than the terminal. Duplicate leaf names
 * retain a short vendor suffix so they never become ambiguous.
 */
export function buildProviderModelLabels(
  providerId: string,
  models: PresentableModel[],
): Map<string, string> {
  if (providerId !== 'openrouter') {
    return new Map(models.map(model => [model.id, model.displayName]))
  }

  const baseLabels = models.map(model => compactModelDisplayName(model.id))
  const counts = new Map<string, number>()
  for (const label of baseLabels) {
    const key = label.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return new Map(
    models.map((model, index) => {
      const label = baseLabels[index]!
      if ((counts.get(label.toLowerCase()) ?? 0) === 1) {
        return [model.id, label]
      }
      const vendor = model.id.includes('/') ? model.id.split('/')[0]! : 'model'
      return [model.id, `${label} · ${vendor}`]
    }),
  )
}
