/**
 * Collapses a model's leaked deliberation out of the visible transcript.
 *
 * Models without a separate thinking channel emit their reasoning as ordinary
 * assistant text: paragraph after paragraph of "Wait", "Maybe", "Could it be",
 * each revising the last, before any conclusion. Prompt instructions ask them
 * not to; weaker models do it anyway, and a user watching the terminal has to
 * scroll past all of it to reach the answer.
 *
 * This is display-only. Nothing is deleted and nothing changes on the wire —
 * the transcript, the session file, and the next request all carry the text
 * unchanged. Synthesizing a `thinking` block instead would have been the
 * natural home for it, but an unsigned one causes an API 400 on the next turn.
 *
 * Only a *leading* run is collapsed, and only when several such paragraphs
 * appear consecutively. A single self-correction is worth reading, and the
 * conclusion after the deliberation is exactly what the user wants, so both
 * stay visible.
 */

/**
 * Openers a paragraph uses when the model is talking to itself. Anchored to
 * the start so "wait for the build" or "maybe later, but here is the fix"
 * inside a sentence never counts.
 */
const DELIBERATION_OPENERS =
  /^(wait|hmm+|hold on|actually|maybe|perhaps|possibly|possibility|could it be|could be|might be|what if|what about|another (thought|possibility|angle|option|idea)|let me (think|reconsider|check|see|read|inspect|look)|let's (think|consider|reconsider|say|try|look)|i (wonder|suspect|think maybe|need to see|could)|but (wait|maybe|then|actually)|unless|alternatively|on second thought|or maybe|why would|so why|is it possible|that would|if so|hmm)\b/i

/** A paragraph that is a bare question to nobody is deliberation too. */
const SELF_QUESTION = /^[^.!]{0,160}\?\s*$/
const INTERNAL_PLANNING_SIGNAL =
  /\b(?:i should|i think|i need to|i can proceed|i will implement|let me|let's|the (?:system |tool |prompt )?guidance says|per guidance|should i|do i need|plan mode|askuserquestion|taskcreate|enterplanmode)\b/gi

/** Anything the user is meant to read or act on, never reasoning. */
function isStructure(paragraph: string): boolean {
  return /^(```|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/.test(paragraph.trim())
}

function isDeliberation(paragraph: string): boolean {
  const trimmed = paragraph.trim()
  if (!trimmed) return false
  if (isStructure(trimmed)) return false
  return DELIBERATION_OPENERS.test(trimmed) || SELF_QUESTION.test(trimmed)
}

function isInternalPlanning(paragraph: string): boolean {
  const trimmed = paragraph.trim()
  if (!trimmed || isStructure(trimmed)) return false
  const signals = [...trimmed.matchAll(INTERNAL_PLANNING_SIGNAL)].length
  return isDeliberation(trimmed) || signals >= 2 || (signals >= 1 && trimmed.length >= 180)
}

/** Consecutive deliberation paragraphs required before any are collapsed. */
const MIN_RUN = 3

export type SplitDeliberation = {
  /** Leading deliberation, in full. Empty when there was none to collapse. */
  deliberation: string
  /** What remains for display. Never empty unless the input was. */
  visible: string
}

export type SplitDeliberationRegion = {
  before: string
  deliberation: string
  after: string
}

export const STREAMING_REASONING_RAIL =
  '> ∴ **Reasoning in progress** · hidden while streaming · full trace preserved'

/**
 * Incremental, display-only projection for the ordinary text stream.
 *
 * The last paragraph is deliberately withheld until its blank-line boundary
 * arrives. That makes classification monotonic: a partial internal-planning
 * paragraph can never be painted as answer text and then disappear once a
 * later delta makes its purpose obvious. Once planning starts, the rest of
 * the live preview stays behind one stable rail; the finalized message still
 * goes through the more precise whole-answer classifier.
 *
 * Each completed character is scanned once (plus a two-character boundary
 * overlap). A bounded suffix check detects replacement/reset without comparing
 * the entire accumulated stream on every token.
 */
export class StreamingDeliberationProjector {
  private source = ''
  private paragraphStart = 0
  private scanOffset = 0
  private rendered = ''
  private reasoningStarted = false
  private insideFence = false

  project(text: string): string {
    if (!text) {
      this.reset()
      return ''
    }
    if (!this.isAppendOnly(text)) this.reset()
    this.source = text

    if (this.reasoningStarted) return this.rendered

    let boundary = text.indexOf('\n\n', this.scanOffset)
    while (boundary >= 0) {
      const paragraph = text.slice(this.paragraphStart, boundary).trim()
      let nextStart = boundary + 2
      while (text[nextStart] === '\n') nextStart++
      this.paragraphStart = nextStart
      this.scanOffset = nextStart

      if (paragraph) {
        const fenceTransitions = paragraph
          .split('\n')
          .filter(line => /^\s*(?:```|~~~)/.test(line)).length
        const wasInsideFence = this.insideFence
        if (fenceTransitions % 2 === 1) this.insideFence = !this.insideFence

        if (!wasInsideFence && isInternalPlanning(paragraph)) {
          this.append(STREAMING_REASONING_RAIL)
          this.reasoningStarted = true
          return this.rendered
        }
        this.append(paragraph)
      }

      boundary = text.indexOf('\n\n', this.scanOffset)
    }

    // A delimiter may be split across two stream deltas. Retain one character
    // of overlap without rescanning the growing unfinished paragraph.
    this.scanOffset = Math.max(this.paragraphStart, text.length - 1)
    return this.rendered
  }

  private append(paragraph: string): void {
    this.rendered = this.rendered
      ? `${this.rendered}\n\n${paragraph}`
      : paragraph
  }

  private isAppendOnly(text: string): boolean {
    if (this.source.length === 0) return true
    if (text.length < this.source.length) return false

    const suffixStart = Math.max(0, this.source.length - 64)
    for (let index = suffixStart; index < this.source.length; index++) {
      if (text.charCodeAt(index) !== this.source.charCodeAt(index)) return false
    }
    return true
  }

  private reset(): void {
    this.source = ''
    this.paragraphStart = 0
    this.scanOffset = 0
    this.rendered = ''
    this.reasoningStarted = false
    this.insideFence = false
  }
}

/**
 * Find a leaked reasoning region anywhere in a long answer. This preserves a
 * useful leading summary/list while condensing the model's later self-talk.
 */
export function splitDeliberationRegion(text: string): SplitDeliberationRegion {
  const paragraphs = text.split(/\n{2,}/)
  if (paragraphs.length < MIN_RUN) {
    return { before: '', deliberation: '', after: text }
  }

  // One forward pass keeps the display filter linear even for a very large
  // local-model dump. The earlier nested scan retried every possible start and
  // became quadratic when an answer consisted entirely of self-talk.
  let start = -1
  let count = 0
  let last = -1
  let gap = 0
  const resultForCandidate = (): SplitDeliberationRegion | null => {
    if (count < MIN_RUN || start < 0 || last < start) return null
    return {
      before: paragraphs.slice(0, start).join('\n\n'),
      deliberation: paragraphs.slice(start, last + 1).join('\n\n'),
      after: paragraphs.slice(last + 1).join('\n\n'),
    }
  }
  const resetCandidate = (): void => {
    start = -1
    count = 0
    last = -1
    gap = 0
  }

  for (let index = 0; index < paragraphs.length; index++) {
    const paragraph = paragraphs[index]!
    if (isStructure(paragraph)) {
      const result = resultForCandidate()
      if (result) return result
      resetCandidate()
      continue
    }
    if (isInternalPlanning(paragraph)) {
      if (start < 0) start = index
      count += 1
      last = index
      gap = 0
      continue
    }
    if (start >= 0) {
      gap += 1
      if (gap > 1) {
        const result = resultForCandidate()
        if (result) return result
        resetCandidate()
      }
    }
  }
  const result = resultForCandidate()
  if (result) return result
  return { before: '', deliberation: '', after: text }
}

export function splitLeadingDeliberation(text: string): SplitDeliberation {
  const paragraphs = text.split(/\n{2,}/)
  if (paragraphs.length < MIN_RUN) {
    return { deliberation: '', visible: text }
  }

  // Real deliberation is not a clean block of markers — it interleaves
  // bridging sentences ("Possibility: ...", "The stack says line 560"). A
  // strict consecutive run therefore stopped at the first bridge and collapsed
  // nothing. Scan while deliberation keeps reappearing, tolerating a single
  // bridging paragraph, and end the region at the last deliberation paragraph
  // so no conclusion is ever swallowed. Structure ends the scan outright.
  let lastDeliberation = -1
  let deliberationCount = 0
  let gap = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]!
    if (isStructure(paragraph)) break
    if (isDeliberation(paragraph)) {
      lastDeliberation = i
      deliberationCount++
      gap = 0
      continue
    }
    gap++
    if (gap > 1) break
  }

  // Nothing conclusive left means this was not a preamble — it was the whole
  // answer, however rambling, and hiding all of it would leave a blank turn.
  if (
    deliberationCount < MIN_RUN ||
    lastDeliberation < 0 ||
    lastDeliberation >= paragraphs.length - 1
  ) {
    return { deliberation: '', visible: text }
  }

  return {
    deliberation: paragraphs.slice(0, lastDeliberation + 1).join('\n\n'),
    visible: paragraphs.slice(lastDeliberation + 1).join('\n\n'),
  }
}

/**
 * One-line stand-in shown where the collapsed paragraphs were, so the user can
 * see that something was hidden rather than silently losing it.
 */
export function describeCollapsedDeliberation(deliberation: string): string {
  const count = deliberation.split(/\n{2,}/).filter(part => part.trim()).length
  const activity = /\b(?:plan|task|approach|guidance)\b/i.test(deliberation)
    ? 'planning approach and task order'
    : /\b(?:test|verify|validation)\b/i.test(deliberation)
      ? 'evaluating implementation and verification choices'
      : 'working through implementation choices'
  return `> ∴ **Reasoning condensed** · ${count} paragraphs · ${activity} · \`ctrl+o\` to expand`
}
