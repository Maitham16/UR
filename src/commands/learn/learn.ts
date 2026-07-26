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
import {
  approveLearnedPlaybook,
  disableLearnedPlaybook,
  getLearnedPlaybook,
  learnedWorkflowLoop,
  listLearnedPlaybooks,
  loadApprovedLearnedWorkflow,
  mineLearnedPlaybooks,
  rejectLearnedPlaybook,
  type LearnedPlaybookStatus,
} from '../../services/agents/learnedPlaybooks.js'
import { formatExecResult } from '../../services/agents/executor.js'
import { runWorkflowSpec } from '../../services/agents/runWorkflow.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function usage(): string {
  return [
    'Usage:',
    '  ur learn [run] [--reflect] [--dry-run] [--json]',
    '  ur learn stats [--json]',
    '  ur learn apply [--dry-run] [--json]',
    '  ur learn playbooks mine [--min-runs <n>] [--dry-run] [--json]',
    '  ur learn playbooks list [--status candidate|approved|rejected|disabled] [--json]',
    '  ur learn playbooks show <id> [--json]',
    '  ur learn playbooks approve <id> [--name <name>] [--dry-run] [--json]',
    '  ur learn playbooks reject <id> --reason <text> [--dry-run] [--json]',
    '  ur learn playbooks disable <id> [--dry-run] [--json]',
    '  ur learn playbooks run <id> [--max-turns <n>] [--max-concurrency <n>] [--dry-run]',
    '',
    'Mines verifiable artifacts (test runs, approved/rejected diffs) into a',
    'per-category / per-model success-rate store that escalate, arena, and',
    'model-route consult. `--reflect` distills lessons from new failures.',
    '`apply` pins the escalation oracle to the best-performing local model.',
  ].join('\n')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index >= 0 ? tokens[index + 1] : undefined
}

function positiveIntegerOption(
  tokens: string[],
  name: string,
  options: { minimum?: number; maximum?: number } = {},
): number | null | undefined {
  if (!tokens.includes(name)) return undefined
  const raw = option(tokens, name)
  if (!raw || !/^\d+$/u.test(raw)) return null
  const parsed = Number(raw)
  const minimum = options.minimum ?? 1
  const maximum = options.maximum ?? Number.MAX_SAFE_INTEGER
  return Number.isSafeInteger(parsed) &&
    parsed >= minimum &&
    parsed <= maximum
    ? parsed
    : null
}

async function handlePlaybooks(
  cwd: string,
  tokens: string[],
  json: boolean,
): Promise<{ type: 'text'; value: string }> {
  const action = tokens[1] ?? 'list'
  const id = tokens[2]
  const dryRun = tokens.includes('--dry-run')
  try {
    if (action === 'mine') {
      const minRuns = positiveIntegerOption(tokens, '--min-runs', {
        minimum: 2,
      })
      if (minRuns === null) {
        process.exitCode = 1
        return {
          type: 'text',
          value: '--min-runs must be an integer of at least 2.',
        }
      }
      const result = mineLearnedPlaybooks(cwd, {
        minSuccessfulRuns: minRuns ?? 3,
        dryRun: tokens.includes('--dry-run'),
      })
      return {
        type: 'text',
        value: json
          ? JSON.stringify(result, null, 2)
          : [
              `Mined ${result.candidates.length} learned playbook candidate(s).`,
              result.skippedUnsafeRuns.length
                ? `Skipped unsafe runs: ${result.skippedUnsafeRuns.join(', ')}`
                : '',
              ...result.candidates.map(
                item =>
                  `- ${item.id} ${item.name} (${item.metrics.pass}/${item.metrics.samples} passed)`,
              ),
            ]
              .filter(Boolean)
              .join('\n'),
      }
    }
    if (action === 'list') {
      const status = option(tokens, '--status') as
        | LearnedPlaybookStatus
        | undefined
      if (
        status !== undefined &&
        !['candidate', 'approved', 'rejected', 'disabled'].includes(status)
      ) {
        process.exitCode = 1
        return {
          type: 'text',
          value:
            '--status must be candidate, approved, rejected, or disabled.',
        }
      }
      const candidates = listLearnedPlaybooks(cwd, status)
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ candidates }, null, 2)
          : candidates.length
            ? candidates
                .map(
                  item =>
                    `${item.id} [${item.status}] ${item.name} — ${item.metrics.pass}/${item.metrics.samples} passed`,
                )
                .join('\n')
            : 'No learned playbooks.',
      }
    }
    if (!id) {
      process.exitCode = 1
      return { type: 'text', value: usage() }
    }
    if (action === 'show') {
      const candidate = getLearnedPlaybook(cwd, id)
      if (!candidate) process.exitCode = 1
      return {
        type: 'text',
        value: candidate
          ? JSON.stringify(candidate, null, 2)
          : `Learned playbook not found: ${id}`,
      }
    }
    if (action === 'approve') {
      const candidate = approveLearnedPlaybook(
        cwd,
        id,
        option(tokens, '--name'),
        { dryRun },
      )
      return {
        type: 'text',
        value: json
          ? JSON.stringify(
              dryRun ? { dryRun: true, candidate } : candidate,
              null,
              2,
            )
          : `${dryRun ? 'Would approve' : 'Approved'} ${candidate.id} as workflow ${candidate.name}.`,
      }
    }
    if (action === 'reject') {
      const candidate = rejectLearnedPlaybook(
        cwd,
        id,
        option(tokens, '--reason') ?? '',
        { dryRun },
      )
      return {
        type: 'text',
        value: json
          ? JSON.stringify(
              dryRun ? { dryRun: true, candidate } : candidate,
              null,
              2,
            )
          : `${dryRun ? 'Would reject' : 'Rejected'} ${candidate.id}.`,
      }
    }
    if (action === 'disable') {
      const candidate = disableLearnedPlaybook(cwd, id, { dryRun })
      return {
        type: 'text',
        value: json
          ? JSON.stringify(
              dryRun ? { dryRun: true, candidate } : candidate,
              null,
              2,
            )
          : `${dryRun ? 'Would disable' : 'Disabled'} ${candidate.id}.`,
      }
    }
    if (action === 'run') {
      const workflow = loadApprovedLearnedWorkflow(cwd, id)
      const parsedTurns = positiveIntegerOption(tokens, '--max-turns')
      const parsedMaxConcurrency = positiveIntegerOption(
        tokens,
        '--max-concurrency',
        { maximum: 16 },
      )
      const parsedLegacyConcurrency = positiveIntegerOption(
        tokens,
        '--concurrency',
        { maximum: 16 },
      )
      const parsedConcurrency =
        parsedMaxConcurrency ?? parsedLegacyConcurrency
      if (parsedTurns === null) {
        process.exitCode = 1
        return {
          type: 'text',
          value: '--max-turns must be a positive integer.',
        }
      }
      if (
        parsedMaxConcurrency === null ||
        parsedLegacyConcurrency === null
      ) {
        process.exitCode = 1
        return {
          type: 'text',
          value:
            '--max-concurrency/--concurrency must be an integer between 1 and 16.',
        }
      }
      const result = await runWorkflowSpec(workflow, {
        cwd,
        loop: learnedWorkflowLoop(workflow),
        dryRun: tokens.includes('--dry-run'),
        resume: tokens.includes('--resume'),
        maxTurns: parsedTurns ?? 30,
        maxConcurrency: parsedConcurrency ?? 1,
        skipPermissions: tokens.includes('--skip-permissions'),
      })
      if (result.status !== 'completed') process.exitCode = 1
      return {
        type: 'text',
        value: json
          ? JSON.stringify(result, null, 2)
          : formatExecResult(result),
      }
    }
    process.exitCode = 1
    return { type: 'text', value: usage() }
  } catch (error) {
    process.exitCode = 1
    return {
      type: 'text',
      value: `Learned playbook error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
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

  if (action === 'playbooks') {
    return handlePlaybooks(cwd, tokens, json)
  }

  if (action === 'stats') {
    return { type: 'text', value: formatStats(loadStats(cwd), json) }
  }

  if (action === 'apply') {
    const stats = loadStats(cwd)
    const best = bestOverallModel(stats)
    if (!best) {
      process.exitCode = 1
      return {
        type: 'text',
        value:
          'Not enough evidence to tune yet. Capture more outcomes (`ur artifacts`, ' +
          '`ur ci-loop`) and run `ur learn` a few times first.',
      }
    }
    const policy = loadPolicy(cwd)
    const next = { ...policy, oracle: best.model }
    const dryRun = tokens.includes('--dry-run')
    if (!dryRun) savePolicy(cwd, next)
    const codingBest = bestModelForCategory(stats, 'coding')
    const payload = {
      dryRun,
      appliedOracle: dryRun ? null : best.model,
      proposedOracle: best.model,
      oracleSuccessRate: Number(best.rate.toFixed(2)),
      codingBest,
    }
    if (json) return { type: 'text', value: JSON.stringify(payload, null, 2) }
    return {
      type: 'text',
      value:
        `${dryRun ? 'Would pin' : 'Pinned'} escalation oracle to ${best.model} ` +
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

  process.exitCode = 1
  return { type: 'text', value: usage() }
}
