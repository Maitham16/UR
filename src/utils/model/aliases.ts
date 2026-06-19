export const MODEL_ALIASES = [
  'modelS',
  'modelO',
  'modelH',
  'best',
  'modelS[1m]',
  'modelO[1m]',
  'modelOplan',
] as const
export type ModelAlias = (typeof MODEL_ALIASES)[number]

export function isModelAlias(modelInput: string): modelInput is ModelAlias {
  return MODEL_ALIASES.includes(modelInput as ModelAlias)
}

/**
 * Bare model family aliases that act as wildcards in the availableModels allowlist.
 * When "modelO" is in the allowlist, ANY modelO model is allowed (modelO 4.5, 4.6, etc.).
 * When a specific model ID is in the allowlist, only that exact version is allowed.
 */
export const MODEL_FAMILY_ALIASES = ['modelS', 'modelO', 'modelH'] as const

export function isModelFamilyAlias(model: string): boolean {
  return (MODEL_FAMILY_ALIASES as readonly string[]).includes(model)
}
