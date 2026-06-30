import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import {
  fanoutBackgroundTasks,
  formatBackgroundList,
  formatBackgroundTask,
  getBackgroundTask,
  listBackgroundTasks,
  readBackgroundLog,
  runBackgroundWorker,
  startBackgroundTask,
  stopBackgroundTask,
} from '../../services/agents/backgroundRunner.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function numberOption(tokens: string[], name: string): number | undefined {
  const raw = option(tokens, name)
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function positionals(tokens: string[]): string[] {
  const withValue = new Set([
    '--agents',
    '--max-turns',
    '--model',
    '--title',
    '--body',
    '--base',
    '--tail',
  ])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (withValue.has(token)) {
      i++
      continue
    }
    if (!token.startsWith('--')) values.push(token)
  }
  return values
}

function usage(): string {
  return [
    'Usage:',
    '  ur bg run "<task>" [--worktree] [--pr] [--title "..."] [--body "..."] [--base main] [--model m] [--max-turns N] [--skip-permissions] [--dry-run] [--json]',
    '  ur bg fanout "<task>" --agents N [--worktree] [--pr] [--dry-run] [--json]',
    '  ur bg list [--json]',
    '  ur bg status <id> [--json]',
    '  ur bg logs <id> [--tail N]',
    '  ur bg attach <id>',
    '  ur bg kill <id>',
  ].join('\n')
}

function startOptions(tokens: string[], task: string) {
  return {
    cwd: getCwd(),
    task,
    worktree: tokens.includes('--worktree'),
    pr: tokens.includes('--pr'),
    draft: tokens.includes('--draft'),
    base: option(tokens, '--base'),
    title: option(tokens, '--title'),
    body: option(tokens, '--body'),
    push: !tokens.includes('--no-push'),
    model: option(tokens, '--model'),
    maxTurns: numberOption(tokens, '--max-turns'),
    skipPermissions: tokens.includes('--skip-permissions'),
    dryRun: tokens.includes('--dry-run'),
  }
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const pos = positionals(tokens)
  const action = pos[0] ?? 'list'

  if (action === 'list' || action === 'ls') {
    return { type: 'text', value: formatBackgroundList(listBackgroundTasks(cwd), json) }
  }

  if (action === 'run') {
    const task = pos.slice(1).join(' ').trim()
    if (!task) return { type: 'text', value: usage() }
    const result = await startBackgroundTask(startOptions(tokens, task))
    if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
    return {
      type: 'text',
      value: result.dryRun
        ? `Background dry run ${result.task.id}\nCommand: ${result.command.join(' ')}`
        : `Started background agent ${result.task.id}\nLog: ${result.task.logFile}`,
    }
  }

  if (action === 'fanout') {
    const task = pos.slice(1).join(' ').trim()
    if (!task) return { type: 'text', value: usage() }
    const results = await fanoutBackgroundTasks({
      ...startOptions(tokens, task),
      agents: numberOption(tokens, '--agents') ?? 3,
    })
    if (json) return { type: 'text', value: JSON.stringify({ results }, null, 2) }
    return {
      type: 'text',
      value: results
        .map(r => `${r.dryRun ? 'Would start' : 'Started'} ${r.task.id}: ${r.task.task}`)
        .join('\n'),
    }
  }

  const id = pos[1]
  if (!id) return { type: 'text', value: usage() }

  if (action === 'status' || action === 'show') {
    const task = getBackgroundTask(cwd, id)
    if (!task) return { type: 'text', value: `Background task not found: ${id}` }
    return { type: 'text', value: json ? JSON.stringify(task, null, 2) : formatBackgroundTask(task) }
  }

  if (action === 'logs' || action === 'log' || action === 'attach') {
    const log = readBackgroundLog(cwd, id, numberOption(tokens, '--tail') ?? (action === 'attach' ? 120 : undefined))
    return { type: 'text', value: log ?? `No log found for background task: ${id}` }
  }

  if (action === 'kill' || action === 'stop' || action === 'cancel') {
    const task = stopBackgroundTask(cwd, id)
    return { type: 'text', value: task ? `Canceled background task ${id}.` : `Background task not found: ${id}` }
  }

  if (action === 'worker') {
    const task = await runBackgroundWorker(cwd, id)
    return { type: 'text', value: json ? JSON.stringify(task, null, 2) : formatBackgroundTask(task) }
  }

  return { type: 'text', value: usage() }
}
