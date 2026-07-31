import type { LocalCommandCall } from '../../types/command.js'
import { listModelCapabilities } from '../model-doctor/model-doctor.js'
import {
  consultOracle,
  formatEscalationResult,
  formatPlan,
  loadPolicy,
  planEscalation,
  runWithEscalation,
  savePolicy,
  type EscalationPolicy,
} from '../../services/agents/escalation.js'
import { loadStats, taskDifficultyBias } from '../../services/agents/learning.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function freeText(tokens: string[], valueFlags: string[]): string {
  const withValue = new Set(valueFlags)
  const parts: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (withValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    parts.push(token)
  }
  return parts.slice(1).join(' ').trim()
}

const VALUE_FLAGS = ['--fast', '--oracle', '--max-turns', '--auto']

function usage(): string {
  return [
    'Usage:',
    '  ur escalate plan "<task>" [--json]',
    '  ur escalate run "<task>" [--dry-run] [--force-oracle] [--max-turns N] [--skip-permissions] [--json]',
    '  ur escalate oracle "<question>" [--dry-run] [--json]',
    '  ur escalate policy [--fast <model>] [--oracle <model>] [--auto on|off] [--json]',
    '',
    'Routine work runs on the fast model; hard reasoning/debug/review auto-escalates',
    'to the strongest local model. Tiers come from `ur model-doctor`.',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = tokens.find(t => !t.startsWith('--')) ?? 'plan'
  const policy = loadPolicy(cwd)

  if (action === 'policy') {
    const next: EscalationPolicy = { ...policy }
    const fast = option(tokens, '--fast')
    const oracle = option(tokens, '--oracle')
    const auto = option(tokens, '--auto')
    if (fast) next.fast = fast
    if (oracle) next.oracle = oracle
    if (auto) next.autoEscalate = auto !== 'off' && auto !== 'false'
    if (fast || oracle || auto) savePolicy(cwd, next)
    return {
      type: 'text',
      value: json
        ? JSON.stringify(next, null, 2)
        : `Escalation policy:\n  fast:   ${next.fast ?? '(auto)'}\n  oracle: ${next.oracle ?? '(auto)'}\n  auto:   ${next.autoEscalate ?? true}`,
    }
  }

  const task = freeText(tokens, VALUE_FLAGS)
  if (!task) return { type: 'text', value: usage() }

  const { models } = await listModelCapabilities()
  const maxTurnsRaw = option(tokens, '--max-turns')
  const maxTurns = maxTurnsRaw ? Number(maxTurnsRaw) : undefined
  // Continual-learning feedback: history of fast-tier failures in this task's
  // category nudges the difficulty up so flaky work escalates sooner.
  const bias = taskDifficultyBias(loadStats(cwd), task)

  if (action === 'oracle') {
    const result = await consultOracle(task, {
      cwd,
      models,
      policy,
      dryRun: tokens.includes('--dry-run'),
      maxTurns,
    })
    return {
      type: 'text',
      value: json
        ? JSON.stringify(result, null, 2)
        : `Oracle [${result.model ?? 'none'}]${result.verdict ? ` (${result.verdict})` : ''}:\n\n${result.output}`,
    }
  }

  if (action === 'run') {
    const result = await runWithEscalation(task, {
      cwd,
      models,
      policy,
      dryRun: tokens.includes('--dry-run'),
      forceOracle: tokens.includes('--force-oracle'),
      skipPermissions: tokens.includes('--skip-permissions'),
      maxTurns,
      bias,
    })
    return { type: 'text', value: formatEscalationResult(result, json) }
  }

  const plan = planEscalation(task, models, policy, { bias })
  return { type: 'text', value: formatPlan(plan, json) }
}
