// Append-only evidence/action ledger (the paper's action log + evidence windows
// + tool-call latency/error tracking). Persisted as JSONL under the project's
// .ur/ folder so it survives sessions and never blocks the agent.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ActionRecord, StabilityLimits } from './types.ts'
import { DEFAULT_LIMITS } from './types.ts'

export function ledgerPath(cwd: string): string {
  return join(cwd, '.ur', 'actions.jsonl')
}

// ── Tool latency tracking ────────────────────────────────────────────────────
const toolStarts = new Map<string, number>()

/** Mark a tool's start (call from the pre-tool hook). */
export function markToolStart(id: string): void {
  toolStarts.set(id, Date.now())
}

/** Consume a tool's elapsed ms (call from the post/failure hook). */
export function takeToolDuration(id: string): number | undefined {
  const start = toolStarts.get(id)
  if (start === undefined) return undefined
  toolStarts.delete(id)
  return Date.now() - start
}

/** Derive touched file path(s) from common tool argument shapes. */
export function filesFromArgs(args: Record<string, unknown> | undefined): string[] {
  if (!args) return []
  const out: string[] = []
  for (const key of ['path', 'file_path', 'filePath', 'notebook_path']) {
    const v = args[key]
    if (typeof v === 'string') out.push(v)
  }
  return out
}

/** Append one action/evidence record. Never throws into the caller's path. */
export function recordAction(cwd: string, record: ActionRecord): void {
  try {
    const file = ledgerPath(cwd)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(record) + '\n')
  } catch {
    /* ledger is best-effort */
  }
}

/** Read the most recent `limit` records (newest last). */
export function readActions(cwd: string, limit = 50): ActionRecord[] {
  const file = ledgerPath(cwd)
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const out: ActionRecord[] = []
  for (const line of lines.slice(-limit)) {
    try {
      out.push(JSON.parse(line) as ActionRecord)
    } catch {
      /* skip malformed */
    }
  }
  return out
}

export interface StabilitySummary {
  total: number
  failures: number
  failureRate: number
  avgDurationMs: number
  maxDurationMs: number
  slowCalls: number
  filesTouched: number
  oscillations: number
  /** Human-readable instability flags (the "stability firewall"). */
  flags: string[]
}

/** Compute the paper's stability metrics + firewall flags from the ledger. */
export function summarize(records: ActionRecord[], limits: StabilityLimits = DEFAULT_LIMITS): StabilitySummary {
  const total = records.length
  const failures = records.filter((r) => !r.ok).length
  const durations = records.map((r) => r.durationMs ?? 0)
  const sum = durations.reduce((a, b) => a + b, 0)
  const avgDurationMs = total ? Math.round(sum / total) : 0
  const maxDurationMs = durations.length ? Math.max(...durations) : 0
  const slowCalls = durations.filter((d) => d > limits.latencyMs).length

  const files = new Set<string>()
  for (const r of records) {
    const p = r.args?.path ?? r.args?.file_path
    if (typeof p === 'string') files.add(p)
  }

  // Oscillation: identical (tool+args) signature repeated maxRepeats+ times.
  // Track failing-signature repeats separately (the paper's repeated-failed-action signal).
  const sigCounts = new Map<string, number>()
  const failSigCounts = new Map<string, number>()
  for (const r of records) {
    const sig = r.tool + ':' + JSON.stringify(r.args ?? {})
    sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1)
    if (!r.ok) failSigCounts.set(sig, (failSigCounts.get(sig) ?? 0) + 1)
  }
  let oscillations = 0
  for (const n of sigCounts.values()) if (n >= limits.maxRepeats) oscillations++
  let repeatedFailures = 0
  for (const n of failSigCounts.values()) if (n >= 2) repeatedFailures++

  const failureRate = total ? failures / total : 0
  const flags: string[] = []
  if (repeatedFailures > 0) flags.push(`${repeatedFailures} repeatedly-failing action(s) (same call failed ≥2×)`)
  if (oscillations > 0) flags.push(`${oscillations} oscillating action(s) (identical call repeated ≥${limits.maxRepeats}×)`)
  if (failureRate >= 0.5 && total >= 4) flags.push(`high failure rate (${Math.round(failureRate * 100)}%)`)
  if (slowCalls > 0) flags.push(`${slowCalls} slow tool call(s) over ${limits.latencyMs}ms`)
  if (files.size > limits.maxFiles) flags.push(`blast radius exceeded (${files.size} > ${limits.maxFiles} files)`)

  return { total, failures, failureRate, avgDurationMs, maxDurationMs, slowCalls, filesTouched: files.size, oscillations, flags }
}
