import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import type { PermissionMode } from '../../types/permissions.js'
import { PERMISSION_MODES } from '../../types/permissions.js'
import {
  cancelCloudTask,
  createCloudTask,
  formatCloudTasks,
  getCloudTask,
  listCloudTasks,
  loadCloudResult,
  readCloudLog,
  reconcileManagedCloudTask,
  runCloudWorker,
  spawnCloudWorker,
  steerCloudTask,
  syncManagedCloudTasks,
} from '../../services/agents/cloudTasks.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'

const FLAGS_WITH_VALUES = new Set([
  '--attempts',
  '--model',
  '--max-turns',
  '--runner',
  '--environment',
  '--permission-mode',
  '--message',
  '--request-id',
  '--tail',
])

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const values: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (FLAGS_WITH_VALUES.has(token)) {
      index++
      continue
    }
    if (!token.startsWith('--')) values.push(token)
  }
  return values
}

function positiveInteger(tokens: string[], flag: string): number | undefined {
  const raw = option(tokens, flag)
  if (!raw || !/^\d+$/u.test(raw)) return undefined
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function invalidPositiveInteger(
  tokens: string[],
  flag: string,
  maximum = Number.MAX_SAFE_INTEGER,
): string | null {
  if (!tokens.includes(flag)) return null
  const raw = option(tokens, flag)
  if (!raw || !/^\d+$/u.test(raw)) {
    return `${flag} must be a positive integer.`
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return `${flag} must be an integer between 1 and ${maximum}.`
  }
  return null
}

function usage(): string {
  return [
    'Usage:',
    '  ur cloud run "<task>" [--runner local|managed] [--attempts N] [--model m] [--max-turns N]',
    '                     [--environment ID] [--permission-mode MODE]',
    '  ur cloud list|sync [--json]',
    '  ur cloud show|logs|cancel <id> [--json]',
    '  ur cloud steer <id> --message "adjust course" [--request-id UUID] [--json]',
    '  ur cloud apply <id>',
    '  ur cloud environments [--json]',
  ].join('\n')
}

export type CloudCommandDependencies = {
  setExitCode?: (code: number) => void
  spawnWorker?: typeof spawnCloudWorker
  runWorker?: typeof runCloudWorker
  applyPatch?: typeof execFileNoThrowWithCwd
}

export async function runCloudCommand(
  args: string,
  cwd: string,
  dependencies: CloudCommandDependencies = {},
): Promise<LocalCommandResult> {
  const failCli = (): void => {
    if (dependencies.setExitCode) dependencies.setExitCode(1)
    else process.exitCode = 1
  }
  const spawnWorker = dependencies.spawnWorker ?? spawnCloudWorker
  const runWorker = dependencies.runWorker ?? runCloudWorker
  const applyPatch = dependencies.applyPatch ?? execFileNoThrowWithCwd
  const tokens = parseArguments(args ?? '')
  const pos = positionals(tokens)
  const action = pos[0] ?? 'list'
  const json = tokens.includes('--json')
  const numericError =
    invalidPositiveInteger(tokens, '--attempts', 8) ??
    invalidPositiveInteger(tokens, '--max-turns') ??
    invalidPositiveInteger(tokens, '--tail')
  if (numericError) {
    failCli()
    return { type: 'text', value: numericError }
  }

  if (action === 'run') {
    const taskText = pos.slice(1).join(' ').trim()
    if (!taskText) {
      failCli()
      return { type: 'text', value: usage() }
    }
    const runnerOption = option(tokens, '--runner')
    if (tokens.includes('--runner') && !runnerOption) {
      failCli()
      return { type: 'text', value: '--runner requires local or managed.' }
    }
    const runnerValue = runnerOption ?? 'local'
    if (runnerValue !== 'local' && runnerValue !== 'managed') {
      failCli()
      return { type: 'text', value: '--runner must be local or managed.' }
    }
    if (
      runnerValue === 'local' &&
      (tokens.includes('--environment') ||
        tokens.includes('--permission-mode'))
    ) {
      failCli()
      return {
        type: 'text',
        value:
          '--environment and --permission-mode require --runner managed.',
      }
    }
    const permissionValue = option(tokens, '--permission-mode')
    if (tokens.includes('--permission-mode') && !permissionValue) {
      failCli()
      return {
        type: 'text',
        value: '--permission-mode requires a valid mode.',
      }
    }
    if (
      permissionValue &&
      !(PERMISSION_MODES as readonly string[]).includes(permissionValue)
    ) {
      failCli()
      return {
        type: 'text',
        value: `Invalid permission mode: ${permissionValue}`,
      }
    }
    const task = createCloudTask(cwd, {
      task: taskText,
      attempts: positiveInteger(tokens, '--attempts') ?? 3,
      model: option(tokens, '--model'),
      maxTurns: positiveInteger(tokens, '--max-turns'),
      runner: runnerValue,
      environmentId: option(tokens, '--environment'),
      permissionMode: permissionValue as PermissionMode | undefined,
    })
    const pid = spawnWorker(cwd, task.id)
    if (pid === null) {
      failCli()
      const failed = getCloudTask(cwd, task.id)
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ task: failed, error: 'worker spawn failed' }, null, 2)
          : `Cloud task ${task.id} could not start: ${failed?.error ?? 'worker spawn failed'}`,
      }
    }
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ ...task, workerPid: pid }, null, 2)
        : `Cloud task ${task.id} started (${
            task.runner === 'managed'
              ? `${task.attempts} managed candidates; PASS + safe branch eligibility`
              : `local best-of-${task.attempts}`
          }, pid ${pid}).\nBrowse: ur cloud list · Result: ur cloud show ${task.id}${
            task.runner === 'local'
              ? ` · Apply winner: ur cloud apply ${task.id}`
              : ` · Steer: ur cloud steer ${task.id} --message "..."`
          }`,
    }
  }

  if (action === 'list' || action === 'ls') {
    return {
      type: 'text',
      value: formatCloudTasks(listCloudTasks(cwd), json),
    }
  }

  if (action === 'sync') {
    const tasks = await syncManagedCloudTasks(cwd)
    return { type: 'text', value: formatCloudTasks(tasks, json) }
  }

  if (action === 'environments' || action === 'envs') {
    try {
      const { fetchEnvironments } = await import('../../utils/teleport/environments.js')
      const environments = await fetchEnvironments()
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ environments }, null, 2)
          : environments.length
            ? environments
                .map(
                  environment =>
                    `${environment.environment_id}  ${environment.kind.padEnd(10)} ${environment.state}  ${environment.name}`,
                )
                .join('\n')
            : 'No managed environments are available.',
      }
    } catch (error) {
      failCli()
      return {
        type: 'text',
        value: `Unable to list managed environments: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
  }

  const id = pos[1]
  if (!id) {
    failCli()
    return { type: 'text', value: usage() }
  }

  if (action === 'show' || action === 'status') {
    let task = getCloudTask(cwd, id)
    if (task?.runner === 'managed' && task.status === 'running') {
      task = await reconcileManagedCloudTask(cwd, id)
    }
    if (!task) {
      failCli()
      return { type: 'text', value: `Cloud task not found: ${id}` }
    }
    const result = task.runner === 'local' ? loadCloudResult(cwd, id) : null
    if (json) {
      return {
        type: 'text',
        value: JSON.stringify({ task, result }, null, 2),
      }
    }
    const lines = [
      `${task.id} — ${task.status} (${
        task.runner === 'managed'
          ? `${task.attempts} managed candidates; deterministic eligibility selection`
          : `local best-of-${task.attempts}`
      })`,
      `Task: ${task.task}`,
    ]
    if (task.runner === 'managed') {
      lines.push('', 'Managed candidates:')
      for (const candidate of task.candidates ?? []) {
        lines.push(
          `  ${candidate.id}${task.winner?.id === candidate.id ? ' ★selected' : ''}  ${candidate.status}  verdict=${candidate.verdict ?? '?'}  eligibility=${candidate.eligible === true ? `rank-${candidate.rank ?? '?'}` : candidate.eligible === false ? `ineligible:${candidate.ineligibilityReason ?? 'unknown'}` : 'pending'}  session=${candidate.sessionId ?? 'pending'}${candidate.branch ? `  branch=${candidate.branch}` : ''}`,
        )
      }
      lines.push(
        '',
        'Managed selection is deterministic eligibility ordering, not comparative quality judging; review the selected branch explicitly.',
      )
      lines.push('', `Logs: ur cloud logs ${task.id}`)
    } else if (result?.candidates) {
      lines.push('', 'Candidates:')
      for (const candidate of result.candidates) {
        lines.push(
          `  ${candidate.id}${result.winner?.id === candidate.id ? ' ★winner' : ''}  verdict=${candidate.verdict ?? '?'}  diff=${candidate.diff?.trim() ? `${candidate.diff.split('\n').length} lines` : 'empty'}`,
        )
      }
      if (result.winner?.diff?.trim()) {
        lines.push('', `Apply the winner: ur cloud apply ${task.id}`)
      }
    } else if (task.status === 'running') {
      lines.push('', `Still running — logs: ur cloud logs ${task.id}`)
    }
    if (task.error) lines.push('', `Error: ${task.error}`)
    return { type: 'text', value: lines.join('\n') }
  }

  if (action === 'logs' || action === 'log') {
    const log = readCloudLog(cwd, id)
    if (log === null) {
      failCli()
      return { type: 'text', value: `No log found for cloud task: ${id}` }
    }
    const tail = positiveInteger(tokens, '--tail')
    const value = tail ? log.split('\n').slice(-tail).join('\n') : log
    return {
      type: 'text',
      value: json ? JSON.stringify({ id, log: value }, null, 2) : value,
    }
  }

  if (action === 'steer' || action === 'message') {
    const message = option(tokens, '--message') ?? pos.slice(2).join(' ')
    const result = await steerCloudTask(cwd, id, message, {
      requestId: option(tokens, '--request-id'),
    })
    if (!result.accepted) failCli()
    return {
      type: 'text',
      value: json
        ? JSON.stringify(result, null, 2)
        : result.accepted
          ? `${result.duplicate ? 'Already delivered' : 'Delivered'} steering ${result.requestId} to ${result.deliveredTo.join(', ')}.`
          : `Steering rejected: ${result.reason ?? 'unknown error'}`,
    }
  }

  if (action === 'cancel' || action === 'stop' || action === 'kill') {
    const before = getCloudTask(cwd, id)
    const task = await cancelCloudTask(cwd, id)
    const canceled =
      before !== null &&
      (before.status === 'queued' || before.status === 'running') &&
      task?.status === 'canceled'
    if (!canceled) failCli()
    return {
      type: 'text',
      value: canceled
        ? json
          ? JSON.stringify(task, null, 2)
          : `Canceled cloud task ${id}.`
        : before
          ? `Cloud task is not active: ${id} (${before.status}).`
          : `Cloud task not found: ${id}`,
    }
  }

  if (action === 'apply') {
    const task = getCloudTask(cwd, id)
    if (task?.runner === 'managed') {
      if (!task.winner?.branch) failCli()
      return {
        type: 'text',
        value: task.winner?.branch
          ? `Managed selection ${task.winner.id} produced eligible branch ${task.winner.branch}. Review/fetch that branch explicitly; UR does not silently merge remote work.`
          : `Managed task ${id} has no eligible PASS review branch yet. Run ur cloud sync, then ur cloud show ${id}.`,
      }
    }
    const result = loadCloudResult(cwd, id)
    const diff = result?.winner?.diff
    if (!diff?.trim()) {
      failCli()
      return {
        type: 'text',
        value: `No winning diff to apply for ${id} — run ur cloud show ${id}`,
      }
    }
    const patchDir = join(cwd, '.ur', 'cloud')
    mkdirSync(patchDir, { recursive: true })
    const patch = join(patchDir, `${id}-winner.patch`)
    writeFileSync(patch, diff)
    const applied = await applyPatch(
      'git',
      ['apply', '--3way', patch],
      {
        cwd,
        timeout: 60_000,
        preserveOutputOnError: true,
      },
    )
    rmSync(patch, { force: true })
    if (applied.code !== 0) failCli()
    return {
      type: 'text',
      value:
        applied.code === 0
          ? `Applied winning diff from ${id} to the working tree. Review with git diff.`
          : `git apply failed (${applied.code}): ${applied.stderr || applied.stdout}`.slice(
              0,
              1500,
            ),
    }
  }

  if (action === 'worker') {
    try {
      await runWorker(cwd, id)
      const task = getCloudTask(cwd, id)
      if (!task || task.status !== 'done') failCli()
      return {
        type: 'text',
        value: `worker finished: ${id} → ${task?.status ?? 'missing'}`,
      }
    } catch (error) {
      failCli()
      return {
        type: 'text',
        value: `worker failed: ${id} → ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
  }

  failCli()
  return { type: 'text', value: usage() }
}

export const call: LocalCommandCall = args =>
  runCloudCommand(args, getCwd())
