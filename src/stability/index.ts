// UR Stability subsystem — the paper's Stability-Aware MAPE-K constructs as a
// self-contained, inspectable module. Surfaced through /stability (+ /evidence,
// /actions). Does not modify UR's core query loop.
export { StabilityMonitor } from './stability.ts'
export { rankCauses, detectSymptoms } from './rootcause.ts'
export { recordAction, readActions, summarize, ledgerPath } from './ledger.ts'
export * from './types.ts'

import { rankCauses } from './rootcause.ts'
import { readActions, summarize } from './ledger.ts'
import { DEFAULT_LIMITS } from './types.ts'

const HELP = `/stability — Stability-Aware MAPE-K controls (from the paper)

Subcommands:
  metrics            stability metrics from the action ledger
  firewall           detect instability (oscillation, failures, latency, blast radius)
  why <error text>   rank likely root causes (causal/Bayesian Analyze stage)
  policy             show the active stability limits (cooldown, blast radius, …)
  evidence [n]       recent evidence/action records (detailed)
  actions [n]        recent action log (compact)
  cooldown           repeated/oscillating action analysis

The ledger lives at .ur/actions.jsonl (run /ur-init to create the .ur folder).`

const fmtPct = (n: number): string => `${Math.round(n * 100)}%`

export async function handleStabilityCommand(tokens: string[], cwd: string): Promise<string> {
  const sub = tokens[1] ?? ''
  const rest = tokens.slice(2)

  switch (sub) {
    case '':
    case 'help':
      return HELP

    case 'policy':
      return [
        'Stability policy (action budget intentionally disabled):',
        `  cooldown window:   ${DEFAULT_LIMITS.cooldownSteps} step(s)`,
        `  oscillation after: ${DEFAULT_LIMITS.maxRepeats} identical repeats`,
        `  blast radius cap:  ${DEFAULT_LIMITS.maxFiles} files`,
        `  latency threshold: ${DEFAULT_LIMITS.latencyMs} ms`,
      ].join('\n')

    case 'why': {
      const text = rest.join(' ').trim()
      if (!text) return 'usage: /stability why <error text>'
      const causes = rankCauses(text)
      if (!causes.length) return 'no likely causes identified'
      return ['likely root causes:', ...causes.map((c) => `  ${fmtPct(c.score)}  ${c.label}`)].join('\n')
    }

    case 'metrics':
    case 'status': {
      const s = summarize(readActions(cwd, 1000))
      if (s.total === 0) return 'no actions recorded yet (ledger: .ur/actions.jsonl)'
      return [
        `actions ${s.total} · failures ${s.failures} (${fmtPct(s.failureRate)})`,
        `latency avg ${s.avgDurationMs}ms · max ${s.maxDurationMs}ms · slow ${s.slowCalls}`,
        `files touched ${s.filesTouched} · oscillations ${s.oscillations}`,
        s.flags.length ? `⚠ ${s.flags.join('; ')}` : 'stable ✓',
      ].join('\n')
    }

    case 'firewall': {
      const s = summarize(readActions(cwd, 1000))
      if (s.total === 0) return 'stability firewall: no actions recorded yet'
      return s.flags.length
        ? ['⚠ stability firewall tripped:', ...s.flags.map((f) => `  - ${f}`), '', 'Consider pausing and proposing a safer plan.'].join('\n')
        : 'stability firewall: stable ✓ (no instability detected)'
    }

    case 'evidence': {
      const n = Number(rest[0]) || 10
      const recs = readActions(cwd, n)
      if (!recs.length) return 'no evidence records yet (.ur/actions.jsonl)'
      return recs
        .map((r) => {
          const meta = [r.durationMs ? `${r.durationMs}ms` : '', r.mode ? `mode:${r.mode}` : '', r.filesTouched?.length ? `files:${r.filesTouched.join(',')}` : '']
            .filter(Boolean)
            .join(' · ')
          return `${r.ts} ${r.ok ? '✓' : '✗'} ${r.tool}${meta ? ` (${meta})` : ''}${r.error ? ` — ${r.error}` : ''}${r.evidence ? `\n    ${r.evidence}` : ''}`
        })
        .join('\n')
    }

    case 'actions': {
      const n = Number(rest[0]) || 20
      const recs = readActions(cwd, n)
      if (!recs.length) return 'no actions recorded yet (.ur/actions.jsonl)'
      return recs.map((r) => `${r.ok ? '✓' : '✗'} ${r.tool}`).join('\n')
    }

    case 'cooldown': {
      const recs = readActions(cwd, 1000)
      const counts = new Map<string, number>()
      for (const r of recs) {
        const sig = r.tool + ':' + JSON.stringify(r.args ?? {})
        counts.set(sig, (counts.get(sig) ?? 0) + 1)
      }
      const repeated = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])
      if (!repeated.length) return 'no repeated actions (cooldown clear)'
      return ['repeated actions (cooldown / oscillation watch):', ...repeated.slice(0, 10).map(([sig, n]) => `  ${n}×  ${sig.slice(0, 80)}`)].join('\n')
    }

    default:
      return `unknown subcommand: ${sub}\n\n${HELP}`
  }
}
