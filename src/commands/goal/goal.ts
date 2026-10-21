import type { LocalCommandCall } from '../../types/command.js'
import {
  addGoalNote,
  createGoal,
  deleteGoal,
  formatGoal,
  formatGoalList,
  listGoals,
  loadGoal,
  setGoalStatus,
} from '../../services/agents/goals.js'
import { runGoalController } from '../../services/agents/goalController.js'
import type { GoalBudget } from '../../services/agents/goals.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  if (index === -1) return undefined
  return tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const withValue = new Set(['--objective', '--workflow', '--pattern', '--note', '--max-turns', '--criterion', '--max-calls', '--max-budget-usd', '--max-duration-ms', '--model'])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (withValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

function budgetOptions(tokens: string[]): GoalBudget {
  const result: GoalBudget = {}
  for (const [flag, key] of [['--max-calls', 'maxCalls'], ['--max-turns', 'maxTurns'], ['--max-budget-usd', 'maxCostUsd'], ['--max-duration-ms', 'maxDurationMs']] as const) {
    if (!tokens.includes(flag)) continue
    const raw = option(tokens, flag), value = Number(raw)
    if (!raw || !Number.isFinite(value) || value <= 0 || (key !== 'maxCostUsd' && !Number.isSafeInteger(value))) throw new Error(`${flag} must be a positive ${key === 'maxCostUsd' ? 'number' : 'integer'}.`)
    result[key] = value
  }
  return result
}

function usage(): string {
  return [
    'Usage:',
    '  ur goal list [--json]',
    '  ur goal add <name> --objective "..." [--workflow <name>] [--pattern <id>] [--criterion "..."] [--max-calls N] [--max-turns N] [--max-budget-usd USD] [--max-duration-ms MS] [--json]',
    '  ur goal show <name> [--json]',
    '  ur goal note <name> --note "progress update"',
    '  ur goal resume <name> [--dry-run] [--max-calls N] [--max-turns N] [--max-budget-usd USD] [--max-duration-ms MS] [--model ID] [--skip-permissions]',
    '  ur goal pause|done|abandon <name>',
    '  ur goal delete <name>',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const positional = positionals(tokens)
  const action = positional[0] ?? 'list'
  const name = positional[1]

  if (action === 'list') {
    return { type: 'text', value: formatGoalList(listGoals(cwd), json) }
  }

  if (action === 'add' || action === 'create') {
    const objective = option(tokens, '--objective')
    if (!name || !objective) return { type: 'text', value: usage() }
    if (tokens.some((token, index) => token === '--criterion' && (!tokens[index + 1] || tokens[index + 1].startsWith('--')))) throw new Error('--criterion requires non-empty text.')
    const spec = createGoal(cwd, name, objective, {
      workflow: option(tokens, '--workflow'),
      pattern: option(tokens, '--pattern'),
      criteria: tokens.flatMap((token, index) => token === '--criterion' && tokens[index + 1] ? [tokens[index + 1]] : []),
      budget: budgetOptions(tokens),
    })
    return { type: 'text', value: json ? formatGoal(spec, true) : `Created goal ${spec.name}.\n\n${formatGoal(spec, false)}` }
  }

  if (!name) return { type: 'text', value: usage() }

  if (action === 'show') {
    const spec = loadGoal(cwd, name)
    if (!spec) return { type: 'text', value: `Goal not found: ${name}` }
    return { type: 'text', value: formatGoal(spec, json) }
  }

  if (action === 'note') {
    const text = option(tokens, '--note')
    if (!text) return { type: 'text', value: 'Provide --note "your progress update".' }
    const spec = addGoalNote(cwd, name, text)
    if (!spec) return { type: 'text', value: `Goal not found: ${name}` }
    return { type: 'text', value: json ? formatGoal(spec, true) : `Logged note on ${spec.name}.` }
  }

  if (action === 'pause' || action === 'done' || action === 'abandon') {
    const status = action === 'pause' ? 'paused' : action === 'done' ? 'done' : 'abandoned'
    const spec = setGoalStatus(cwd, name, status)
    if (!spec) return { type: 'text', value: `Goal not found: ${name}` }
    return { type: 'text', value: json ? formatGoal(spec, true) : `Goal ${spec.name} is now ${spec.status}.` }
  }

  if (action === 'delete' || action === 'remove') {
    return {
      type: 'text',
      value: deleteGoal(cwd, name) ? `Deleted goal ${name}.` : `Goal not found: ${name}`,
    }
  }

  if (action === 'resume') {
    const spec = loadGoal(cwd, name)
    if (!spec) return { type: 'text', value: `Goal not found: ${name}` }
    const dryRun = tokens.includes('--dry-run')
    const result = await runGoalController(name, {
      cwd, dryRun, budget: budgetOptions(tokens), model: option(tokens, '--model'),
      skipPermissions: tokens.includes('--skip-permissions') || tokens.includes('--dangerously-skip-permissions'),
    })
    return { type: 'text', exitCode: result.status !== 'done' && !dryRun ? 1 : 0, value: json ? JSON.stringify(result, null, 2) :
      `${dryRun ? 'Preview (no execution or outcome verification)' : 'Goal controller result'}\n\n${formatGoal(result, false)}` }

  }

  return { type: 'text', value: usage() }
}
