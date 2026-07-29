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
import { runWorkflowSpec } from '../../services/agents/runWorkflow.js'
import { loadWorkflow } from '../../services/agents/workflows.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  if (index === -1) return undefined
  return tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const withValue = new Set(['--objective', '--workflow', '--pattern', '--note', '--max-turns'])
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

function usage(): string {
  return [
    'Usage:',
    '  ur goal list [--json]',
    '  ur goal add <name> --objective "..." [--workflow <name>] [--pattern <id>] [--json]',
    '  ur goal show <name> [--json]',
    '  ur goal note <name> --note "progress update"',
    '  ur goal resume <name> [--dry-run] [--max-turns N]',
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
    if (!name || !objective) {
      return { type: 'text', value: usage(), exitCode: 2 }
    }
    const spec = createGoal(cwd, name, objective, {
      workflow: option(tokens, '--workflow'),
      pattern: option(tokens, '--pattern'),
    })
    return { type: 'text', value: json ? formatGoal(spec, true) : `Created goal ${spec.name}.\n\n${formatGoal(spec, false)}` }
  }

  if (!name) return { type: 'text', value: usage(), exitCode: 2 }

  if (action === 'show') {
    const spec = loadGoal(cwd, name)
    if (!spec) {
      return {
        type: 'text',
        value: `Goal not found: ${name}`,
        exitCode: 1,
      }
    }
    return { type: 'text', value: formatGoal(spec, json) }
  }

  if (action === 'note') {
    const text = option(tokens, '--note')
    if (!text) {
      return {
        type: 'text',
        value: 'Provide --note "your progress update".',
        exitCode: 2,
      }
    }
    const spec = addGoalNote(cwd, name, text)
    if (!spec) {
      return {
        type: 'text',
        value: `Goal not found: ${name}`,
        exitCode: 1,
      }
    }
    return { type: 'text', value: json ? formatGoal(spec, true) : `Logged note on ${spec.name}.` }
  }

  if (action === 'pause' || action === 'done' || action === 'abandon') {
    const status = action === 'pause' ? 'paused' : action === 'done' ? 'done' : 'abandoned'
    const spec = setGoalStatus(cwd, name, status)
    if (!spec) {
      return {
        type: 'text',
        value: `Goal not found: ${name}`,
        exitCode: 1,
      }
    }
    return { type: 'text', value: json ? formatGoal(spec, true) : `Goal ${spec.name} is now ${spec.status}.` }
  }

  if (action === 'delete' || action === 'remove') {
    const deleted = deleteGoal(cwd, name)
    return {
      type: 'text',
      value: deleted ? `Deleted goal ${name}.` : `Goal not found: ${name}`,
      ...(deleted ? {} : { exitCode: 1 }),
    }
  }

  if (action === 'resume') {
    const spec = loadGoal(cwd, name)
    if (!spec) {
      return {
        type: 'text',
        value: `Goal not found: ${name}`,
        exitCode: 1,
      }
    }
    if (!spec.workflow) {
      return {
        type: 'text',
        value: `Goal ${spec.name} has no linked workflow. Run \`ur route ${JSON.stringify(spec.objective)}\` to pick an approach, then add one with --workflow.`,
        exitCode: 1,
      }
    }
    const workflow = loadWorkflow(cwd, spec.workflow)
    if (!workflow) {
      return {
        type: 'text',
        value: `Linked workflow not found: ${spec.workflow}`,
        exitCode: 1,
      }
    }
    const dryRun = tokens.includes('--dry-run')
    const maxTurnsRaw = option(tokens, '--max-turns')
    const maxTurns = maxTurnsRaw === undefined ? undefined : Number(maxTurnsRaw)
    if (
      maxTurns !== undefined &&
      (!Number.isSafeInteger(maxTurns) || maxTurns < 1)
    ) {
      return {
        type: 'text',
        value: '--max-turns must be a positive integer.',
        exitCode: 2,
      }
    }
    let result: Awaited<ReturnType<typeof runWorkflowSpec>>
    try {
      result = await runWorkflowSpec(workflow, {
        cwd,
        dryRun,
        resume: true,
        maxTurns,
      })
    } catch (error) {
      return {
        type: 'text',
        value: `Goal workflow failed: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      }
    }
    addGoalNote(cwd, name, `Resumed workflow ${spec.workflow}: ${result.status} (${result.steps.filter(s => s.status === 'done').length}/${result.steps.length} steps)`)
    if (result.status === 'completed') setGoalStatus(cwd, name, 'done')
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ goal: spec.name, run: result }, null, 2)
        : `Resumed goal ${spec.name} via workflow ${spec.workflow}: ${result.status} (${result.steps.filter(s => s.status === 'done').length}/${result.steps.length} steps done).`,
      ...(result.status === 'completed' ? {} : { exitCode: 1 }),
    }
  }

  return { type: 'text', value: usage(), exitCode: 2 }
}
