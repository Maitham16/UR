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
  steerBackgroundTask,
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

function invalidPositiveInteger(
  tokens: string[],
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): string | null {
  if (!tokens.includes(name)) return null
  const raw = option(tokens, name)
  if (!raw || !/^\d+$/u.test(raw)) {
    return `${name} must be a positive integer.`
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    return `${name} must be an integer between 1 and ${maximum}.`
  }
  return null
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
    '--route',
    '--message',
    '--request-id',
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
    '  ur bg run "<task>" [--worktree] [--pr] [--title "..."] [--body "..."] [--base main] [--model m] [--route auto|cheap|strong|default] [--max-turns N] [--skip-permissions] [--dry-run] [--json]',
    '  ur bg fanout "<task>" --agents N [--worktree] [--pr] [--route auto|cheap|strong|default] [--dry-run] [--json]',
    '  ur bg list [--json]',
    '  ur bg status <id> [--json]',
    '  ur bg logs <id> [--tail N]',
    '  ur bg attach <id>',
    '  ur bg steer <id> --message "adjust course" [--request-id UUID] [--json]',
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
    routeStrategy: option(tokens, '--route') as 'auto' | 'cheap' | 'strong' | 'default' | undefined,
    maxTurns: numberOption(tokens, '--max-turns'),
    skipPermissions: tokens.includes('--skip-permissions'),
    dryRun: tokens.includes('--dry-run'),
    offline: tokens.includes('--offline'),
  }
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const pos = positionals(tokens)
  const action = pos[0] ?? 'list'
  const numericError =
    invalidPositiveInteger(tokens, '--agents', 32) ??
    invalidPositiveInteger(tokens, '--max-turns') ??
    invalidPositiveInteger(tokens, '--tail')
  if (numericError) {
    process.exitCode = 1
    return { type: 'text', value: numericError }
  }
  const route = option(tokens, '--route')
  if (
    route !== undefined &&
    !['auto', 'cheap', 'strong', 'default'].includes(route)
  ) {
    process.exitCode = 1
    return {
      type: 'text',
      value: '--route must be auto, cheap, strong, or default.',
    }
  }
  if (
    (action === 'run' || action === 'fanout') &&
    tokens.includes('--pr') &&
    !tokens.includes('--worktree')
  ) {
    process.exitCode = 1
    return {
      type: 'text',
      value: '--pr requires --worktree to isolate commits from local changes.',
    }
  }

  if (action === 'list' || action === 'ls') {
    return { type: 'text', value: formatBackgroundList(listBackgroundTasks(cwd), json) }
  }

  if (action === 'run') {
    const task = pos.slice(1).join(' ').trim()
    if (!task) {
      process.exitCode = 1
      return { type: 'text', value: usage() }
    }
    const options = startOptions(tokens, task)
    if (options.offline) {
      process.env.UR_OFFLINE = '1'
    }
    const result = await startBackgroundTask(options)
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
    if (!task) {
      process.exitCode = 1
      return { type: 'text', value: usage() }
    }
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
  if (!id) {
    process.exitCode = 1
    return { type: 'text', value: usage() }
  }

  if (action === 'status' || action === 'show') {
    const task = getBackgroundTask(cwd, id)
    if (!task) {
      process.exitCode = 1
      return { type: 'text', value: `Background task not found: ${id}` }
    }
    return { type: 'text', value: json ? JSON.stringify(task, null, 2) : formatBackgroundTask(task) }
  }

  if (action === 'logs' || action === 'log' || action === 'attach') {
    const log = readBackgroundLog(cwd, id, numberOption(tokens, '--tail') ?? (action === 'attach' ? 120 : undefined))
    if (log === null) process.exitCode = 1
    return { type: 'text', value: log ?? `No log found for background task: ${id}` }
  }

  if (action === 'steer' || action === 'message') {
    const message = option(tokens, '--message') ?? pos.slice(2).join(' ')
    const result = steerBackgroundTask(cwd, id, message, {
      requestId: option(tokens, '--request-id'),
      actor: 'cli',
    })
    if (!result.accepted) process.exitCode = 1
    return {
      type: 'text',
      value: json
        ? JSON.stringify(result, null, 2)
        : result.accepted
          ? `${result.duplicate ? 'Already accepted' : 'Accepted'} steering ${result.requestId} for background task ${id}.`
          : `Steering rejected: ${result.reason ?? 'unknown error'}`,
    }
  }

  if (action === 'kill' || action === 'stop' || action === 'cancel') {
    const before = getBackgroundTask(cwd, id)
    const task = stopBackgroundTask(cwd, id)
    const canceled =
      before !== null &&
      (before.status === 'queued' || before.status === 'running') &&
      task?.status === 'canceled'
    if (!canceled) process.exitCode = 1
    return {
      type: 'text',
      value: canceled
        ? `Canceled background task ${id}.`
        : before
          ? `Background task is not active: ${id} (${before.status}).`
          : `Background task not found: ${id}`,
    }
  }

  if (action === 'worker') {
    const task = await runBackgroundWorker(cwd, id)
    if (task?.status !== 'completed') process.exitCode = 1
    return { type: 'text', value: json ? JSON.stringify(task, null, 2) : formatBackgroundTask(task) }
  }

  process.exitCode = 1
  return { type: 'text', value: usage() }
}
