import {
  DEFAULT_LIMITS,
  type Signals,
  type StabilityLimits,
  type StabilityVerdict,
  type ToolCallLike,
} from './types.ts'

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const obj = value as Record<string, unknown>
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  )
}

/**
 * Operationalizes the paper's Plan-stage stability constraints: cooldown,
 * oscillation suppression, and bounded blast radius. (Action budget is
 * intentionally omitted per project policy.) Breaching a hard limit returns a
 * containment verdict so a caller can stop cleanly instead of thrashing.
 */
export class StabilityMonitor {
  private readonly lastStep = new Map<string, number>()
  private readonly counts = new Map<string, number>()
  private readonly files = new Set<string>()
  step = 0
  actions = 0
  oscillations = 0
  private readonly limits: StabilityLimits

  constructor(limits: StabilityLimits = DEFAULT_LIMITS) {
    this.limits = limits
  }

  signature(call: ToolCallLike): string {
    return call.name + ':' + stableStringify(call.arguments)
  }

  tick(): void {
    this.step++
  }

  /** Pre-dispatch gate (cooldown / oscillation / blast radius). */
  check(call: ToolCallLike, mutates: boolean, filePath?: string): StabilityVerdict {
    const sig = this.signature(call)
    const last = this.lastStep.get(sig)
    if (last !== undefined && this.step - last <= this.limits.cooldownSteps) {
      const repeats = (this.counts.get(sig) ?? 0) + 1
      if (repeats >= this.limits.maxRepeats) {
        this.oscillations++
        return { allow: false, reason: `oscillation suppressed: repeated ${call.name}`, containment: true }
      }
    }
    if (mutates && filePath && !this.files.has(filePath) && this.files.size + 1 > this.limits.maxFiles) {
      return { allow: false, reason: `blast-radius cap reached (${this.limits.maxFiles} files)`, containment: true }
    }
    return { allow: true }
  }

  /** Record an allowed + dispatched action. */
  record(call: ToolCallLike, mutates: boolean, filePath?: string): void {
    const sig = this.signature(call)
    this.actions++
    this.lastStep.set(sig, this.step)
    this.counts.set(sig, (this.counts.get(sig) ?? 0) + 1)
    if (mutates && filePath) this.files.add(filePath)
  }

  signals(): Signals {
    return {
      step: this.step,
      actions: this.actions,
      filesTouched: this.files.size,
      recentSignatures: [...this.lastStep.keys()].slice(-5),
    }
  }
}
