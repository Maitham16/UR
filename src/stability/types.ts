// Stability-Aware MAPE-K types (ported from the 309 agent), self-contained.
// Implements the paper's Plan-stage stability constructs and Analyze-stage
// root-cause abstraction as an additive, inspectable subsystem.

export interface ToolCallLike {
  name: string
  arguments: Record<string, unknown>
}

/** Rolling-window signals consumed by the Monitor stage. */
export interface Signals {
  step: number
  actions: number
  filesTouched: number
  recentSignatures: string[]
}

export interface StabilityLimits {
  /** Max distinct files mutated per task (blast radius). */
  maxFiles: number
  /** Window within which an identical action counts as a repeat (cooldown). */
  cooldownSteps: number
  /** Repeats of an identical action before it is suppressed (oscillation). */
  maxRepeats: number
  /** Tool-call latency (ms) above which a call is flagged as degraded. */
  latencyMs: number
}

export const DEFAULT_LIMITS: StabilityLimits = {
  maxFiles: 20,
  cooldownSteps: 2,
  maxRepeats: 3,
  latencyMs: 30_000,
}

export interface StabilityVerdict {
  allow: boolean
  reason?: string
  /** If true, the loop should stop (containment) rather than skip one action. */
  containment?: boolean
}

/** One row in the evidence/action ledger (the paper's action log + evidence window). */
export interface ActionRecord {
  ts: string
  tool: string
  args?: Record<string, unknown>
  ok: boolean
  durationMs?: number
  error?: string
  /** Permission/working mode active when the action ran. */
  mode?: string
  /** File path(s) the action touched, derived from its arguments. */
  filesTouched?: string[]
  /** Optional links to a plan / rollback snapshot (reserved for richer flows). */
  planId?: string
  rollbackSnapshotId?: string
  resultSummary?: string
  /** Free-form evidence window summary captured when the action ran. */
  evidence?: string
}

export interface CauseScore {
  id: string
  label: string
  score: number
}
