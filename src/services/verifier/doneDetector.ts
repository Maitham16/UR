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
  | 'generic_done'

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
  return null
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
