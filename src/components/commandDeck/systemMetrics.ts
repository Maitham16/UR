import { cpus, freemem, totalmem } from 'node:os'
import type { Metric } from './metrics.js'

/**
 * System metrics for the deck's right column.
 *
 * Sampled, not computed per render. `cpus()` reports cumulative tick counts
 * since boot, so a single reading says nothing about current load — the value
 * only means anything as a delta between two samples. Rendering would
 * otherwise show a number that never changes and looks like a stuck gauge.
 *
 * Returns null rather than 0 when a reading is unavailable. The deck renders
 * null as "--", so an unknown metric reads as unknown instead of as idle,
 * which is the difference between "no data" and "nothing happening".
 */

type CpuSample = { idle: number; total: number }

function sampleCpu(): CpuSample | null {
  const cores = cpus()
  if (!cores || cores.length === 0) return null
  let idle = 0
  let total = 0
  for (const core of cores) {
    const times = core.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

let previous: CpuSample | null = null

/**
 * Percent of CPU time spent non-idle since the previous call.
 *
 * The first call has no previous sample and returns null — reporting 0% for a
 * reading we have not taken yet would be a fabricated number on every startup.
 */
export function readCpuPercent(): number | null {
  const current = sampleCpu()
  if (!current) return null
  const last = previous
  previous = current
  if (!last) return null
  const idleDelta = current.idle - last.idle
  const totalDelta = current.total - last.total
  if (totalDelta <= 0) return null
  const used = 100 * (1 - idleDelta / totalDelta)
  return Math.max(0, Math.min(100, used))
}

/** Resets sampling state so a fresh session does not inherit a stale delta. */
export function resetCpuSampling(): void {
  previous = null
}

export function readMemoryPercent(): number | null {
  const total = totalmem()
  const free = freemem()
  if (!Number.isFinite(total) || total <= 0) return null
  if (!Number.isFinite(free) || free < 0) return null
  return Math.max(0, Math.min(100, 100 * (1 - free / total)))
}

/**
 * The three metrics the deck shows. Context is supplied by the caller: it is
 * session state, not machine state, and the deck should not reach into the
 * conversation to find it.
 */
export function readSystemMetrics(contextPercent: number | null): Metric[] {
  return [
    { label: 'CPU', percent: readCpuPercent() },
    { label: 'MEM', percent: readMemoryPercent() },
    { label: 'CTX', percent: contextPercent },
  ]
}
