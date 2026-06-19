import memoize from 'lodash-es/memoize.js'

/**
 * Bedrock model helpers. The AWS Bedrock backend has been removed from the
 * external build; only safe no-op/data helpers remain for callers that still
 * import them.
 */

export const getBedrockInferenceProfiles = memoize(async function (): Promise<
  string[]
> {
  // Bedrock inference profiles are not available in external builds.
  return []
})

export function findFirstMatch(
  profiles: string[],
  substring: string,
): string | null {
  return profiles.find(p => p.includes(substring)) ?? null
}

export async function createBedrockRuntimeClient() {
  throw new Error('AWS Bedrock is not supported in this build.')
}

export const getInferenceProfileBackingModel = memoize(async function (
  _profileId: string,
): Promise<string | null> {
  // Bedrock inference profiles are not available in external builds.
  return null
})

/**
 * Check if a model ID is a foundation model (e.g., "anthropic.ur-sonnet-4-5-20250929-v1:0")
 */
export function isFoundationModel(modelId: string): boolean {
  return modelId.startsWith('anthropic.')
}

/**
 * Cross-region inference profile prefixes for Bedrock.
 */
const BEDROCK_REGION_PREFIXES = ['us', 'eu', 'apac', 'global'] as const

export type BedrockRegionPrefix = (typeof BEDROCK_REGION_PREFIXES)[number]

/**
 * Extract the model/inference profile ID from a Bedrock ARN.
 */
export function extractModelIdFromArn(modelId: string): string {
  if (!modelId.startsWith('arn:')) {
    return modelId
  }
  const lastSlashIndex = modelId.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return modelId
  }
  return modelId.substring(lastSlashIndex + 1)
}

/**
 * Extract the region prefix from a Bedrock cross-region inference model ID.
 */
export function getBedrockRegionPrefix(
  modelId: string,
): BedrockRegionPrefix | undefined {
  const effectiveModelId = extractModelIdFromArn(modelId)

  for (const prefix of BEDROCK_REGION_PREFIXES) {
    if (effectiveModelId.startsWith(`${prefix}.anthropic.`)) {
      return prefix
    }
  }
  return undefined
}

/**
 * Apply a region prefix to a Bedrock model ID.
 */
export function applyBedrockRegionPrefix(
  modelId: string,
  prefix: BedrockRegionPrefix,
): string {
  const existingPrefix = getBedrockRegionPrefix(modelId)
  if (existingPrefix) {
    return modelId.replace(`${existingPrefix}.`, `${prefix}.`)
  }

  if (isFoundationModel(modelId)) {
    return `${prefix}.${modelId}`
  }

  return modelId
}
