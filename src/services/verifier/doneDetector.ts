// "Done"-claim detector + gate.
//
// Heuristic: detect assistant text that claims a task is complete (created,
// fixed, wrote, ran a command, etc.) and verify against the tool-effect
// ledger. If the agent claims completion but never made a matching tool
// call, the gate flags the turn so the loop can inject a corrective
// reminder instead of yielding the false claim to the user.

/**
 * Phrases that signal a completion claim. Matches are word-boundary so
 * substrings inside larger words (e.g. "edited" matching "credited") don't
 * fire. Order matters only for description; matching is OR-ed.
 */
const DONE_PATTERNS: RegExp[] = [
  /\b(?:i|i've|i have)\s+(?:created|added|written|wrote|made)\b/i,
  /\b(?:i|i've|i have)\s+(?:edited|updated|changed|modified|patched|fixed)\b/i,
  /\b(?:i|i've|i have)\s+(?:deleted|removed)\b/i,
  /\b(?:i|i've|i have)\s+(?:ran|executed|run)\b/i,
  /\bdone[!.]\s*$/i,
  /\ball\s+(?:set|done|finished)\b/i,
  /\btask\s+(?:is\s+)?(?:complete|completed|done)\b/i,
  /\bthat\s+(?:should\s+)?(?:do\s+it|fix\s+it|work)\b/i,
]

export type ClaimKind =
  | 'write_claim'
  | 'edit_claim'
  | 'delete_claim'
  | 'run_claim'
  | 'write_intent'
  | 'run_intent'
  | 'generic_done'

const WRITE_INTENT_VERBS =
  '(?:create|write|edit|update|change|modify|patch|fix|remove|delete|rewrite|implement)'
const RUN_INTENT_VERBS = '(?:run|execute|test|build)'
const WRITE_INTENT_GERUNDS =
  '(?:creating|writing|editing|updating|changing|modifying|patching|fixing|removing|deleting|rewriting|implementing)'

function detectImmediateIntent(text: string): ClaimKind | null {
  // Only inspect the final visible clause. This catches turns that end with
  // "Let me create it now" without treating an earlier plan as a promise that
  // a tool call must immediately follow.
  const tail = text.trim().slice(-600)
  const clauses = tail
    .split(/(?:\n+|(?<=[.!?])\s+)/)
    .map(clause => clause.trim())
    .filter(Boolean)
  const clause = clauses.at(-1) ?? ''
  if (
    !clause ||
    /^(?:if|when|once|after|before)\b/i.test(clause) ||
    /\b(?:if|when|once|after|unless|until)\b.+$/i.test(clause)
  ) {
    return null
  }

  const lead = "(?:now[, :]*)?(?:let me|i(?:'ll| will| am going to|'m going to))"
  if (new RegExp(`\\b${lead}\\s+(?:now\\s+)?${WRITE_INTENT_VERBS}\\b`, 'i').test(clause)) {
    return 'write_intent'
  }
  if (new RegExp(`\\b${lead}\\s+(?:now\\s+)?${RUN_INTENT_VERBS}\\b`, 'i').test(clause)) {
    return 'run_intent'
  }
  if (new RegExp(`^${WRITE_INTENT_GERUNDS}\\b.*\\bnow[.!]?$`, 'i').test(clause)) {
    return 'write_intent'
  }
  return null
}

/**
 * Inspect assistant text for a completion claim. Returns the kind of claim
 * (so the gate can look for a matching tool effect) or null if none.
 */
export function detectDoneClaim(text: string): ClaimKind | null {
  if (!text) return null
  if (
    /\bi\s+(?:created|added|written|wrote|made)\b/i.test(text) ||
    /\bi've\s+(?:created|added|written|wrote|made)\b/i.test(text) ||
    /\bi have\s+(?:created|added|written|wrote|made)\b/i.test(text)
  ) {
    return 'write_claim'
  }
  if (
    /\bi\s+(?:edited|updated|changed|modified|patched|fixed)\b/i.test(text) ||
    /\bi've\s+(?:edited|updated|changed|modified|patched|fixed)\b/i.test(text) ||
    /\bi have\s+(?:edited|updated|changed|modified|patched|fixed)\b/i.test(text)
  ) {
    return 'edit_claim'
  }
  if (
    /\bi\s+(?:deleted|removed)\b/i.test(text) ||
    /\bi've\s+(?:deleted|removed)\b/i.test(text) ||
    /\bi have\s+(?:deleted|removed)\b/i.test(text)
  ) {
    return 'delete_claim'
  }
  if (
    /\bi\s+(?:ran|executed|run)\b/i.test(text) ||
    /\bi've\s+(?:ran|executed|run)\b/i.test(text) ||
    /\bi have\s+(?:ran|executed|run)\b/i.test(text)
  ) {
    return 'run_claim'
  }
  for (const pattern of DONE_PATTERNS) {
    if (pattern.test(text)) return 'generic_done'
  }
  return detectImmediateIntent(text)
}

export type DoneGateResult =
  | { ok: true }
  | { ok: false; claim: ClaimKind; reason: string; reminder: string }

/**
 * Validate a "done"-claim against the ledger.
 *
 * @param claim what the assistant text claims
 * @param hasMutatingEffect true if the ledger recorded any successful
 *   Write/Edit/Bash/NotebookEdit this turn
 * @param ranBash true if a successful Bash call was recorded this turn
 */
export function evaluateDoneGate(
  claim: ClaimKind,
  hasMutatingEffect: boolean,
  ranBash: boolean,
): DoneGateResult {
  if (claim === 'write_claim' || claim === 'edit_claim' || claim === 'delete_claim') {
    if (hasMutatingEffect) return { ok: true }
    return {
      ok: false,
      claim,
      reason: 'no file-mutating tool call recorded',
      reminder:
        'You claimed to have created, edited, or deleted files this turn but no Write / Edit / NotebookEdit / Bash tool call returned successfully. Make the actual tool call now, or correct the statement before continuing.',
    }
  }
  if (claim === 'write_intent') {
    if (hasMutatingEffect) return { ok: true }
    return {
      ok: false,
      claim,
      reason: 'promised file action ended without a mutating tool call',
      reminder:
        'You ended by saying you were about to create, edit, or fix files, but no Write / Edit / NotebookEdit / Bash tool call returned successfully. Make the actual tool call now, or explain why you cannot continue.',
    }
  }
  if (claim === 'run_claim') {
    if (ranBash) return { ok: true }
    return {
      ok: false,
      claim,
      reason: 'no successful Bash call recorded',
      reminder:
        'You claimed to have run a command this turn but no Bash tool call returned successfully. Run the command now or correct the statement.',
    }
  }
  if (claim === 'run_intent') {
    if (ranBash) return { ok: true }
    return {
      ok: false,
      claim,
      reason: 'promised command ended without a successful Bash call',
      reminder:
        'You ended by saying you were about to run a command, but no Bash tool call returned successfully. Run the command now, or explain why you cannot continue.',
    }
  }
  // generic_done: only flag if the turn was completely effect-free
  if (hasMutatingEffect || ranBash) return { ok: true }
  return {
    ok: false,
    claim,
    reason: 'no side-effecting tool call this turn',
    reminder:
      'You declared the task complete but this turn made no Write / Edit / Bash / NotebookEdit tool call. If the task required no edits, say so explicitly. Otherwise, make the tool call now.',
  }
}
