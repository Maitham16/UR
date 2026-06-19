import type { LocalCommandCall } from '../../types/command.js'
import { loadPolicy, savePolicy } from '../../services/agents/escalation.js'
import {
  bestModelForCategory,
  formatLearnResult,
  formatStats,
  loadStats,
  runLearn,
  type LearnStats,
} from '../../services/agents/learning.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function usage(): string {
  return [
    'Usage:',
    '  ur learn [run] [--reflect] [--dry-run] [--json]',
    '  ur learn stats [--json]',
    '  ur learn apply [--json]',
    '',
    'Mines verifiable artifacts (test runs, approved/rejected diffs) into a',
    'per-category / per-model success-rate store that escalate, arena, and',
    'model-route consult. `--reflect` distills lessons from new failures.',
    '`apply` pins the escalation oracle to the best-performing local model.',
  ].join('\n')
}

/** Best overall model by learned success rate, requiring a minimum sample. */
function bestOverallModel(
  stats: LearnStats,
  minSamples = 5,
): { model: string; rate: number } | null {
  let best: { model: string; rate: number } | null = null
  for (const [model, tally] of Object.entries(stats.models)) {
    const total = tally.pass + tally.fail
    if (total < minSamples) continue
    const rate = tally.pass / total
    if (!best || rate > best.rate) best = { model, rate }
  }
  return best
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = tokens.find(token => !token.startsWith('--')) ?? 'run'

  if (action === 'help') return { type: 'text', value: usage() }

  if (action === 'stats') {
    return { type: 'text', value: formatStats(loadStats(cwd), json) }
  }

  if (action === 'apply') {
    const stats = loadStats(cwd)
    const best = bestOverallModel(stats)
    if (!best) {
      return {
        type: 'text',
        value:
          'Not enough evidence to tune yet. Capture more outcomes (`ur artifacts`, ' +
          '`ur ci-loop`) and run `ur learn` a few times first.',
      }
    }
    const policy = loadPolicy(cwd)
    const next = { ...policy, oracle: best.model }
    savePolicy(cwd, next)
    const codingBest = bestModelForCategory(stats, 'coding')
    const payload = {
      appliedOracle: best.model,
      oracleSuccessRate: Number(best.rate.toFixed(2)),
      codingBest,
    }
    if (json) return { type: 'text', value: JSON.stringify(payload, null, 2) }
    return {
      type: 'text',
      value:
        `Pinned escalation oracle to ${best.model} ` +
        `(${Math.round(best.rate * 100)}% success over learned runs).` +
        (codingBest
          ? `\nBest for coding: ${codingBest.model} (${Math.round(codingBest.rate * 100)}%).`
          : ''),
    }
  }

  if (action === 'run') {
    const result = await runLearn({
      cwd,
      reflect: tokens.includes('--reflect'),
      dryRun: tokens.includes('--dry-run'),
    })
    return { type: 'text', value: formatLearnResult(result, json) }
  }

  return { type: 'text', value: usage() }
}
