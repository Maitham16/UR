import type { ExecEvent, ExecStatus, Verdict } from './executor.js'

/**
 * Live multi-agent execution board.
 *
 * A small, pure state machine that folds the workflow executor's event stream
 * into a per-step status snapshot, so concurrent agents can be shown as they
 * run rather than reconstructed afterwards from a transcript. It is the live
 * counterpart to the post-hoc `ur agent-inspect` timeline: feed it executor
 * events (including `wave` for parallel batches) and render a unified board at
 * any moment. Rendering is separated from I/O so the same engine drives a TTY
 * redraw, a CI log, or a returned summary.
 */

export type LiveStepState = 'pending' | 'running' | 'done' | 'failed' | 'held'

export type LiveStep = {
  id: string
  agent: string
  state: LiveStepState
  verdict: Verdict | null
  iteration: number
}

export type LiveCounts = Record<LiveStepState, number> & { total: number }

const GLYPH: Record<LiveStepState, string> = {
  pending: '·',
  running: '▶',
  done: '✓',
  failed: '✗',
  held: '⏸',
}

export class LiveExecutionBoard {
  readonly name: string
  private readonly steps = new Map<string, LiveStep>()
  private readonly order: string[] = []
  iteration = 1
  waves = 0
  status: ExecStatus | null = null

  constructor(name: string, seed: Array<{ id: string; agent: string }> = []) {
    this.name = name
    for (const step of seed) this.touch(step.id, step.agent)
  }

  private touch(id: string, agent?: string): LiveStep {
    let step = this.steps.get(id)
    if (!step) {
      step = {
        id,
        agent: agent ?? '',
        state: 'pending',
        verdict: null,
        iteration: this.iteration,
      }
      this.steps.set(id, step)
      this.order.push(id)
    } else if (agent) {
      step.agent = agent
    }
    return step
  }

  /** Fold a single executor event into the board. */
  apply(event: ExecEvent): void {
    switch (event.kind) {
      case 'wave':
        this.waves += 1
        this.iteration = event.iteration
        for (const id of event.ids) this.touch(id)
        break
      case 'step-start': {
        const step = this.touch(event.id, event.agent)
        step.state = 'running'
        step.iteration = event.iteration
        break
      }
      case 'step-done': {
        const step = this.touch(event.id)
        step.state = event.isError ? 'failed' : 'done'
        if (event.verdict) step.verdict = event.verdict
        break
      }
      case 'gate':
        if (event.result === 'hold') this.touch(event.id).state = 'held'
        break
      case 'loop':
        this.iteration = event.iteration
        break
      case 'finish':
        this.status = event.status
        break
    }
  }

  snapshot(): LiveStep[] {
    return this.order.map(id => this.steps.get(id) as LiveStep)
  }

  counts(): LiveCounts {
    const counts: LiveCounts = {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      held: 0,
      total: 0,
    }
    for (const id of this.order) {
      const step = this.steps.get(id)
      if (!step) continue
      counts[step.state] += 1
      counts.total += 1
    }
    return counts
  }

  /** A unified, multi-line snapshot of every step's current state. */
  renderBoard(): string {
    const counts = this.counts()
    const header = this.status
      ? `workflow ${this.name} — ${this.status} (${counts.done}/${counts.total} done` +
        `${counts.failed ? `, ${counts.failed} failed` : ''}` +
        `${counts.held ? `, ${counts.held} held` : ''})`
      : `workflow ${this.name} — iteration ${this.iteration} · ` +
        `▶ ${counts.running} running · ✓ ${counts.done}/${counts.total} done`
    const width = Math.min(
      18,
      Math.max(8, ...this.order.map(id => id.length)),
    )
    const lines = [header]
    for (const step of this.snapshot()) {
      const verdict = step.verdict ? `  VERDICT: ${step.verdict}` : ''
      const note = step.state === 'running' ? '  …' : ''
      lines.push(
        `  ${GLYPH[step.state]} ${step.id.padEnd(width)} (${step.agent})${note}${verdict}`,
      )
    }
    return lines.join('\n')
  }
}

/** One human-readable line for streaming a single event as it happens. */
export function formatLiveEvent(event: ExecEvent): string | null {
  switch (event.kind) {
    case 'wave':
      return event.ids.length > 1
        ? `▶ running ${event.ids.length} in parallel: ${event.ids.join(', ')}`
        : null
    case 'step-start':
      return `▶ ${event.id} (${event.agent}) started`
    case 'step-done':
      return `${event.isError ? '✗' : '✓'} ${event.id} done${
        event.verdict ? ` — VERDICT: ${event.verdict}` : ''
      }`
    case 'gate':
      return `⛓ ${event.id} gate ${event.gate} → ${event.result}`
    case 'loop':
      return `↻ loop ${event.from} → ${event.to} (iteration ${event.iteration})`
    case 'finish':
      return `■ finished: ${event.status}`
    default:
      return null
  }
}
