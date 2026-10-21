// Tool-effect ledger.
//
// Source of truth for "what side effects did the agent produce on this turn?"
// Records only effects whose tool result was successful (no is_error flag).
// Read by:
// - done-claim gate (was a Write/Edit/Bash/PowerShell actually called this turn?)
// - project gates (did this turn modify files? if so, run afterEdit commands)
// - loop detector (have we just retried an identical call?)
//
// One ledger instance per QueryEngine / session. Keyed by the originating
// user-request UUID so multiple background tasks can share one ledger.

import type { ToolUseBlock } from '@urhq-ai/sdk/resources/index.mjs'

export type ToolEffect = {
  toolName: string
  /** Tool use id from the assistant message. */
  toolUseId: string
  /** Best-effort: file path for Write/Edit, shell command, undefined otherwise. */
  target?: string
  /** True if the tool result was not is_error. */
  succeeded: boolean
  /** Wall-clock time the effect was recorded. */
  at: number
}

export type TurnEffects = {
  turnId: string
  effects: ToolEffect[]
}

export class ToolEffectLedger {
  private turns = new Map<string, TurnEffects>()
  private observedFiles = new Map<string, Set<string>>()

  /** Actual content changes, including failed shell commands with partial writes. */
  recordObservedChanges(turnId: string, files: string[]): void {
    const observed = this.observedFiles.get(turnId) ?? new Set<string>()
    for (const file of files) observed.add(file)
    this.observedFiles.set(turnId, observed)
  }

  /**
   * Record one tool result. Called after the tool returns and we know
   * whether the result was an error.
   */
  record(
    turnId: string,
    toolUse: ToolUseBlock,
    succeeded: boolean,
  ): void {
    const target = extractTarget(toolUse)
    const effect: ToolEffect = {
      toolName: toolUse.name,
      toolUseId: toolUse.id,
      target,
      succeeded,
      at: Date.now(),
    }
    const existing = this.turns.get(turnId)
    if (existing) {
      existing.effects.push(effect)
    } else {
      this.turns.set(turnId, { turnId, effects: [effect] })
    }
  }

  /** All effects for a turn, or undefined if the turn hasn't started. */
  get(turnId: string): TurnEffects | undefined {
    return this.turns.get(turnId)
  }

  /**
   * Direct successful writes or observed workspace changes. A successful shell
   * command alone is not evidence that any file changed.
   */
  hasMutatingEffect(turnId: string): boolean {
    const t = this.turns.get(turnId)
    return Boolean(this.observedFiles.get(turnId)?.size) ||
      Boolean(t?.effects.some(e => e.succeeded && isMutatingTool(e.toolName)))
  }

  /** Distinct successful-write target paths for this turn (for gate filtering). */
  modifiedFiles(turnId: string): string[] {
    const t = this.turns.get(turnId)
    const out = new Set(this.observedFiles.get(turnId))
    for (const e of t?.effects ?? []) {
      if (!e.succeeded) continue
      if (e.toolName !== 'Write' && e.toolName !== 'Edit' && e.toolName !== 'NotebookEdit') {
        continue
      }
      if (e.target) out.add(e.target)
    }
    return [...out]
  }

  /** Did the agent run any Bash this turn? */
  ranBash(turnId: string): boolean {
    const t = this.turns.get(turnId)
    if (!t) return false
    return t.effects.some(e => e.toolName === 'Bash' && e.succeeded)
  }

  /** Did the agent run any supported shell command this turn? */
  ranShell(turnId: string): boolean {
    const t = this.turns.get(turnId)
    if (!t) return false
    return t.effects.some(
      e =>
        (e.toolName === 'Bash' || e.toolName === 'PowerShell') && e.succeeded,
    )
  }

  /** Drop turn state once it's no longer needed (e.g. session compaction). */
  forget(turnId: string): void {
    this.turns.delete(turnId)
    this.observedFiles.delete(turnId)
  }

  clear(): void {
    this.turns.clear()
    this.observedFiles.clear()
  }
}

const MUTATING_TOOLS = new Set([
  'Write',
  'Edit',
  'NotebookEdit',
])

function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name)
}

function extractTarget(toolUse: ToolUseBlock): string | undefined {
  const input = toolUse.input as Record<string, unknown> | null
  if (!input || typeof input !== 'object') return undefined
  if (typeof input.file_path === 'string') return input.file_path
  if (typeof input.path === 'string') return input.path
  if (typeof input.command === 'string') return input.command
  return undefined
}
