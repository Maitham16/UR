import type { LocalCommandCall } from '../../types/command.js'
import {
  addCrewTask,
  createCrew,
  deleteCrew,
  formatCrew,
  formatCrewList,
  formatRunCrewResult,
  listCrews,
  loadCrew,
  reopenClaimed,
  runCrew,
} from '../../services/agents/crew.js'
import { decomposeTask, formatDecomposition } from '../../services/agents/decomposer.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  if (index === -1) return undefined
  return tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const withValue = new Set([
    '--goal',
    '--task',
    '--lead',
    '--workers',
    '--max-workers',
    '--max-turns',
    '--max-attempts',
    '--retry-backoff-ms',
  ])
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
    '  ur crew list [--json]',
    '  ur crew create <name> --goal "..." [--lead <agent>] [--decompose] [--json]',
    '  ur crew plan <name> --goal "..." [--decompose] [--json]',
    '  ur crew show <name> [--json]',
    '  ur crew add <name> --task "another subtask"',
    '  ur crew run <name> [--workers N] [--dynamic] [--max-workers N] [--worktrees] [--max-attempts N] [--retry-backoff-ms N] [--dry-run] [--resume] [--decompose] [--max-turns N] [--skip-permissions] [--json]',
    '  ur crew reset <name>',
    '  ur crew delete <name>',
    '',
    'A lead decomposes the goal into a shared task board; workers claim and run',
    'open tasks as headless `ur -p` subagents (optionally each in a git worktree).',
    'Independent tasks run in parallel. Failed mutating tasks retry only when',
    '`--worktrees` gives every attempt a fresh checkout.',
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
    return { type: 'text', value: formatCrewList(listCrews(cwd), json) }
  }

  if (action === 'create') {
    const goal = option(tokens, '--goal')
    if (!name || !goal) return { type: 'text', value: usage() }
    const decompose = tokens.includes('--decompose')
    const decomposed = decompose ? await decomposeTask(goal, { cwd, dryRun: tokens.includes('--dry-run') }) : undefined
    const spec = createCrew(cwd, name, goal, { lead: option(tokens, '--lead'), decomposed })
    return {
      type: 'text',
      value: json ? formatCrew(spec, true) : `Created crew ${spec.name} with ${spec.tasks.length} task(s).\n\n${formatCrew(spec, false)}`,
    }
  }

  if (action === 'plan') {
    const goal = option(tokens, '--goal')
    if (!goal) return { type: 'text', value: usage() }
    const tasks = await decomposeTask(goal, { cwd, dryRun: tokens.includes('--dry-run') })
    const result = {
      goal,
      tasks,
      rollbackPoint: tasks[0]?.rollbackPoint ?? 'HEAD',
      generatedAt: new Date().toISOString(),
    }
    return { type: 'text', value: formatDecomposition(result, json) }
  }

  if (!name) return { type: 'text', value: usage() }

  if (action === 'show') {
    const spec = loadCrew(cwd, name)
    if (!spec) return { type: 'text', value: `Crew not found: ${name}` }
    return { type: 'text', value: formatCrew(spec, json) }
  }

  if (action === 'add') {
    const task = option(tokens, '--task')
    if (!task) return { type: 'text', value: 'Provide --task "subtask instruction".' }
    const spec = addCrewTask(cwd, name, task)
    if (!spec) return { type: 'text', value: `Crew not found: ${name}` }
    return { type: 'text', value: json ? formatCrew(spec, true) : `Added a task to ${spec.name} (now ${spec.tasks.length}).` }
  }

  if (action === 'reset') {
    const spec = reopenClaimed(cwd, name)
    if (!spec) return { type: 'text', value: `Crew not found: ${name}` }
    return { type: 'text', value: json ? formatCrew(spec, true) : `Reopened in-progress tasks on ${spec.name}.` }
  }

  if (action === 'delete' || action === 'remove') {
    return { type: 'text', value: deleteCrew(cwd, name) ? `Deleted crew ${name}.` : `Crew not found: ${name}` }
  }

  if (action === 'run') {
    const spec = loadCrew(cwd, name)
    if (!spec) {
      const goal = option(tokens, '--goal')
      if (!goal) return { type: 'text', value: `Crew not found: ${name}` }
      const decomposed = await decomposeTask(goal, { cwd, dryRun: tokens.includes('--dry-run') })
      createCrew(cwd, name, goal, { lead: option(tokens, '--lead'), decomposed })
    } else if (tokens.includes('--decompose') && spec.tasks.length === 0) {
      const decomposed = await decomposeTask(spec.goal, { cwd, dryRun: tokens.includes('--dry-run') })
      createCrew(cwd, name, spec.goal, { lead: spec.lead, decomposed })
    }
    const workersRaw = option(tokens, '--workers')
    const maxTurnsRaw = option(tokens, '--max-turns')
    const events: string[] = []
    const result = await runCrew(name, {
      cwd,
      workers: workersRaw ? Number(workersRaw) : 1,
      dynamic: tokens.includes('--dynamic'),
      maxWorkers: option(tokens, '--max-workers')
        ? Number(option(tokens, '--max-workers'))
        : undefined,
      maxAttempts: option(tokens, '--max-attempts')
        ? Number(option(tokens, '--max-attempts'))
        : undefined,
      retryBackoffMs: option(tokens, '--retry-backoff-ms')
        ? Number(option(tokens, '--retry-backoff-ms'))
        : undefined,
      dryRun: tokens.includes('--dry-run'),
      worktrees: tokens.includes('--worktrees'),
      resume: tokens.includes('--resume'),
      skipPermissions: tokens.includes('--skip-permissions'),
      maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined,
      onEvent: event => {
        if (event.kind === 'claim') events.push(`  ${event.worker} claimed ${event.taskId} (${event.title})`)
        else if (event.kind === 'done') events.push(`  ${event.worker} finished ${event.taskId}: ${event.status}`)
        else if (event.kind === 'retry') events.push(`  ${event.worker} retrying ${event.taskId} as attempt ${event.attempt} after ${event.delayMs}ms`)
        else if (event.kind === 'retry-skipped') events.push(`  ${event.worker} did not retry ${event.taskId}: ${event.reason}`)
      },
    })
    const trace = !json && events.length ? `\n\nTimeline:\n${events.join('\n')}` : ''
    return { type: 'text', value: `${formatRunCrewResult(result, json)}${trace}` }
  }

  return { type: 'text', value: usage() }
}
