/**
 * One answer to "can this model see images".
 *
 * There were three, and they disagreed. The Ollama adapter asked
 * `modelCapabilityEnabled(capabilities, 'vision')`, which returns
 * `capabilities?.has(x) ?? true` — so a model whose `/api/show` returned
 * nothing was assumed vision-capable. model-doctor had a private
 * name-matching `inferVision`. modelRouter read a precomputed `likelyVision`.
 *
 * The binary shape is what made the answers wrong: absence of evidence was
 * being reported as evidence, in one direction by the adapter and the other by
 * the name heuristic. A model can genuinely be in a third state — nothing
 * advertised, name says nothing — and callers need to distinguish "this model
 * cannot see" from "I could not find out", because those warrant opposite
 * advice.
 */
export type VisionSupport = 'supported' | 'unsupported' | 'unknown'

/**
 * Families that ship vision weights. Name matching is a fallback for servers
 * that do not advertise capabilities; it can confirm support but never rule it
 * out, since an unrecognised name means nothing either way.
 */
const VISION_NAME_HINTS = [
  'vision',
  'llava',
  'moondream',
  'minicpm-v',
  'bakllava',
  'llama3.2-vision',
  'qwen2-vl',
  'qwen2.5vl',
  'gemma3',
  'pixtral',
  'internvl',
  'cogvlm',
] as const

export function nameSuggestsVision(model: string): boolean {
  const lowered = model.toLowerCase()
  return VISION_NAME_HINTS.some(hint => lowered.includes(hint))
}

/**
 * `capabilities` is the set from the provider (Ollama's `/api/show`), or null
 * when it could not be fetched or the provider has no such endpoint.
 *
 * An advertised capability list is authoritative in both directions: a server
 * that lists capabilities and omits `vision` really does not have it. Only
 * when there is no list do we fall back to the name, and an unrecognised name
 * yields `unknown` rather than `unsupported`.
 */
export function resolveVisionSupport(
  model: string,
  capabilities: ReadonlySet<string> | null | undefined,
): VisionSupport {
  if (capabilities && capabilities.size > 0) {
    return capabilities.has('vision') ? 'supported' : 'unsupported'
  }
  return nameSuggestsVision(model) ? 'supported' : 'unknown'
}

/**
 * Whether to put image bytes on the wire. `unknown` sends them: refusing to
 * send on a maybe would break every server that does not implement a
 * capabilities endpoint, and a model that cannot use them ignores them.
 */
export function shouldSendImages(support: VisionSupport): boolean {
  return support !== 'unsupported'
}

/**
 * What to tell the model when an image could not be delivered, or was
 * delivered without confirmation. Returns null when support is confirmed and
 * there is nothing worth saying.
 *
 * The wording matters: asserting "this model has no vision support" when the
 * truth is "the server did not say" sends the user to change models for no
 * reason.
 */
export function describeVisionSupport(
  support: VisionSupport,
  model: string,
  imageCount: number,
): string | null {
  if (imageCount === 0 || support === 'supported') return null
  const plural = imageCount === 1 ? '1 image' : `${imageCount} images`
  const named = model ? `"${model}"` : 'the selected model'
  if (support === 'unsupported') {
    return (
      `[${plural} could not be sent: ${named} advertises its capabilities and ` +
      `vision is not among them, so it cannot see images. Tell the user this ` +
      `directly and suggest switching to a vision model with /model.]`
    )
  }
  return (
    `[${plural} sent, but ${named} does not advertise its capabilities, so ` +
    `vision support could not be confirmed. If you cannot see the image, say ` +
    `so plainly rather than guessing at its contents.]`
  )
}
