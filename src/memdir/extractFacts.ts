/**
 * Automatic memory extraction.
 *
 * Existing memory is explicit: the user runs `/remember`. This layer proposes
 * candidates from conversation instead, which is the mem0-style pattern the
 * 2026 agent-memory work converged on.
 *
 * Deliberately rule-based rather than model-driven. An extra model call per
 * turn costs latency and money on every single turn, and a model asked "what
 * is worth remembering?" reliably over-answers. Precision matters far more
 * than recall here: a wrong memory is re-injected into every future session
 * and is worse than no memory at all. Candidates are proposals — the caller
 * decides whether to persist them.
 */

import type { MemoryType } from './memoryTypes.js'

export type FactCandidate = {
  text: string
  type: MemoryType
  /** 0..1. Only the strongest signals reach 1. */
  confidence: number
  /** Which rule fired, so a bad rule can be identified from stored output. */
  rule: string
}

export const MAX_FACT_CHARS = 300
export const MIN_FACT_CHARS = 12

type Rule = {
  name: string
  pattern: RegExp
  type: MemoryType
  confidence: number
}

/**
 * Ordered by strength. Each pattern anchors on an explicit statement of
 * durable preference or constraint — not on opinions about the current task,
 * which do not generalise to later sessions.
 */
const RULES: Rule[] = [
  {
    name: 'explicit-always-never',
    pattern:
      /\b(?:always|never)\s+(?:use|run|commit|push|deploy|write|call|prefer|do)\b[^.!?\n]{4,}/i,
    type: 'user',
    confidence: 0.9,
  },
  {
    name: 'stated-preference',
    pattern:
      /\bI\s+(?:prefer|like|want|expect)\b[^.!?\n]{4,}/i,
    type: 'user',
    confidence: 0.8,
  },
  {
    name: 'prohibition',
    pattern:
      /\b(?:don'?t|do not|please avoid|stop)\s+(?:use|using|run|running|commit|push|add|create|write)\b[^.!?\n]{4,}/i,
    type: 'user',
    confidence: 0.85,
  },
  {
    name: 'project-convention',
    pattern:
      /\b(?:we|this (?:project|repo|team))\s+(?:use|uses|follow|follows|require|requires|standardis|standardiz)\w*\b[^.!?\n]{4,}/i,
    type: 'project',
    confidence: 0.75,
  },
  {
    name: 'build-or-test-command',
    pattern:
      /\b(?:to\s+)?(?:build|test|lint|deploy|run)\s+(?:it|this|the\s+\w+)\s*,?\s*(?:you\s+)?(?:use|run)\b[^.!?\n]{4,}/i,
    type: 'project',
    confidence: 0.8,
  },
  {
    name: 'correction',
    pattern:
      /\b(?:actually|no,|not that)\b[^.!?\n]*\b(?:it'?s|use|should be)\b[^.!?\n]{4,}/i,
    type: 'project',
    confidence: 0.6,
  },
]

/**
 * Phrases that look like durable facts but describe only the current task.
 * Without this filter the store fills with one-shot instructions that are
 * actively misleading when replayed into a later, unrelated session.
 */
const EPHEMERAL_RE =
  /\b(?:right now|for now|just this once|temporarily|in this case|for this (?:one|task|file)|today|currently)\b/i

/** Never store anything that looks like a credential. */
const SECRET_RE =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S{6,})/i

export function looksLikeSecret(text: string): boolean {
  return SECRET_RE.test(text)
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '')
}

/** Comparison key for dedup: case- and punctuation-insensitive. */
export function factKey(text: string): string {
  return normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Propose durable facts from a single user message.
 *
 * Only user messages are scanned. Extracting from assistant output would let
 * the agent teach itself its own guesses and reinforce them across sessions.
 */
export function extractFactCandidates(userMessage: string): FactCandidate[] {
  if (!userMessage || userMessage.length > 20_000) return []
  const candidates: FactCandidate[] = []
  const seen = new Set<string>()
  // Sentence-ish split; keeps rules anchored to one statement at a time.
  const sentences = userMessage
    .split(/(?<=[.!?\n])\s+/)
    .map(normalize)
    .filter(Boolean)

  for (const sentence of sentences) {
    if (sentence.length < MIN_FACT_CHARS) continue
    if (sentence.length > MAX_FACT_CHARS) continue
    if (EPHEMERAL_RE.test(sentence)) continue
    if (looksLikeSecret(sentence)) continue
    for (const rule of RULES) {
      if (!rule.pattern.test(sentence)) continue
      const key = factKey(sentence)
      if (!key || seen.has(key)) break
      seen.add(key)
      candidates.push({
        text: sentence,
        type: rule.type,
        confidence: rule.confidence,
        rule: rule.name,
      })
      // First (strongest) matching rule wins for a given sentence.
      break
    }
  }
  return candidates
}

/**
 * Drop candidates already covered by stored memory. Exact-key equality plus
 * containment: a stored line that already contains the candidate means the
 * candidate adds nothing.
 */
export function filterNovelFacts(
  candidates: FactCandidate[],
  existingMemories: string[],
): FactCandidate[] {
  const existingKeys = new Set(existingMemories.map(factKey))
  const existingText = existingMemories.map(factKey)
  return candidates.filter(candidate => {
    const key = factKey(candidate.text)
    if (existingKeys.has(key)) return false
    return !existingText.some(
      stored => stored.includes(key) || key.includes(stored),
    )
  })
}

/**
 * Full pass for one turn: extract, drop known facts, and keep only candidates
 * at or above the confidence floor, strongest first.
 */
export function proposeMemories(
  userMessage: string,
  existingMemories: string[] = [],
  minConfidence = 0.75,
): FactCandidate[] {
  return filterNovelFacts(extractFactCandidates(userMessage), existingMemories)
    .filter(candidate => candidate.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
}
