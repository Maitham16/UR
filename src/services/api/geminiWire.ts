/**
 * Internal metadata key used to retain Gemini GenerateContent thought
 * signatures while messages pass through the provider-neutral transcript.
 *
 * Gemini requires a signature to be sent back on the exact Part where it was
 * received. Keeping it separate from Anthropic's `signature` field prevents
 * one provider's opaque state from being mistaken for another provider's.
 */
export const GEMINI_THOUGHT_SIGNATURE = 'gemini_thought_signature' as const

export function getGeminiThoughtSignature(part: unknown): string | undefined {
  if (!part || typeof part !== 'object') return undefined
  const value = part as Record<string, unknown>
  const signature = value.thoughtSignature ?? value.thought_signature
  return typeof signature === 'string' && signature.length > 0
    ? signature
    : undefined
}

export function getStoredGeminiThoughtSignature(
  block: unknown,
): string | undefined {
  if (!block || typeof block !== 'object') return undefined
  const signature = (block as Record<string, unknown>)[GEMINI_THOUGHT_SIGNATURE]
  return typeof signature === 'string' && signature.length > 0
    ? signature
    : undefined
}
