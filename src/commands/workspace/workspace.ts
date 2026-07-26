import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { workspaceInfo } from '../../ur/sysinfo.js'
import {
  addWorkspaceRepository,
  addWorkspaceTask,
  createWorkspace,
  generateWorkspacePrPlan,
  generateWorkspaceRollbackPlan,
  getWorkspace,
  loadWorkspaceState,
  runWorkspace,
  validateWorkspace,
  verifyWorkspace,
} from '../../services/agents/workspaceCoordinator.js'

function usage(): string {
  return [
    'Usage:',
    '  ur workspace',
    '  ur workspace init <name> [--dry-run]',
    '  ur workspace add <name> <repo-id> <path> [--base <ref>] [--verify <command>] [--dry-run]',
    '  ur workspace task <name> <task-id> --repo <repo-id> --prompt <text> [--depends-on a,b] [--dry-run]',
    '  ur workspace show <name> [--json]',
    '  ur workspace validate <name> [--json]',
    '  ur workspace run <name> [--resume] [--max-concurrency <n>] [--max-turns <n>] [--dry-run]',
    '  ur workspace status <name> [--json]',
    '  ur workspace verify <name> [--json]',
    '  ur workspace pr-plan <name> [--json]',
    '  ur workspace rollback-plan <name> [--json]',
  ].join('\n')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index >= 0 ? tokens[index + 1] : undefined
}

function options(tokens: string[], name: string): string[] {
  return tokens.flatMap((token, index) =>
    token === name && tokens[index + 1] ? [tokens[index + 1]!] : [],
  )
}

function positionals(tokens: string[]): string[] {
  const valued = new Set([
    '--base',
    '--verify',
    '--repo',
    '--prompt',
    '--depends-on',
    '--max-concurrency',
    '--max-turns',
  ])
  const result: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    if (valued.has(tokens[index]!)) {
      index++
      continue
    }
    if (!tokens[index]!.startsWith('--')) result.push(tokens[index]!)
  }
  return result
}

function numberOption(
  tokens: string[],
  name: string,
  fallback: number,
): number {
  const parsed = Number(option(tokens, name) ?? fallback)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
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
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return `${name} must be an integer between 1 and ${maximum}.`
  }
  return null
}

function formatState(
  state: NonNullable<ReturnType<typeof loadWorkspaceState>>,
): string {
  return [
    `Workspace ${state.workspace}: ${state.status} (${state.runId})`,
    ...state.repositories.map(
      repo => `  repo ${repo.id}: ${repo.branch} at ${repo.worktree}`,
    ),
    ...state.tasks.map(
      task =>
        `  task ${task.id} [${task.repository}]: ${task.status}${task.error ? ` — ${task.error}` : ''}`,
    ),
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const positional = positionals(tokens)
  const action = positional[0]
  const json = tokens.includes('--json')
  const dryRun = tokens.includes('--dry-run')
  if (!action) return { type: 'text', value: workspaceInfo(cwd) }
  const numericError =
    invalidPositiveInteger(tokens, '--max-concurrency', 16) ??
    invalidPositiveInteger(tokens, '--max-turns')
  if (numericError) {
    process.exitCode = 1
    return { type: 'text', value: numericError }
  }

  try {
    if (action === 'init') {
      if (!positional[1]) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const spec = createWorkspace(cwd, positional[1], { dryRun })
      return {
        type: 'text',
        value: json
          ? JSON.stringify(dryRun ? { dryRun: true, spec } : spec, null, 2)
          : `${dryRun ? 'Would create' : 'Created'} workspace ${spec.name}.`,
      }
    }
    if (action === 'add') {
      const [, name, id, path] = positional
      if (!name || !id || !path) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const spec = await addWorkspaceRepository(cwd, name, {
        id,
        path,
        baseRef: option(tokens, '--base'),
        verify: options(tokens, '--verify'),
        dryRun,
      })
      return {
        type: 'text',
        value: json
          ? JSON.stringify(dryRun ? { dryRun: true, spec } : spec, null, 2)
          : `${dryRun ? 'Would add' : 'Added'} repository ${id} to ${name}.`,
      }
    }
    if (action === 'task') {
      const [, name, id] = positional
      const repository = option(tokens, '--repo')
      const prompt = option(tokens, '--prompt')
      if (!name || !id || !repository || !prompt) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const spec = addWorkspaceTask(cwd, name, {
        id,
        repository,
        prompt,
        dependsOn: (option(tokens, '--depends-on') ?? '')
          .split(',')
          .map(value => value.trim())
          .filter(Boolean),
        dryRun,
      })
      return {
        type: 'text',
        value: json
          ? JSON.stringify(dryRun ? { dryRun: true, spec } : spec, null, 2)
          : `${dryRun ? 'Would add' : 'Added'} task ${id} to ${name}.`,
      }
    }
    if (action === 'show') {
      if (!positional[1]) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const spec = getWorkspace(cwd, positional[1])
      return {
        type: 'text',
        value: JSON.stringify(spec, null, 2),
      }
    }
    if (action === 'validate') {
      if (!positional[1]) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const validation = await validateWorkspace(cwd, positional[1])
      if (!validation.valid) process.exitCode = 1
      return {
        type: 'text',
        value: json
          ? JSON.stringify(validation, null, 2)
          : [
              `Workspace validation: ${validation.valid ? 'PASS' : 'FAIL'}`,
              ...validation.errors.map(error => `- ${error}`),
              `Task order: ${validation.order.join(' -> ') || '(none)'}`,
            ].join('\n'),
      }
    }
    if (action === 'run') {
      if (!positional[1]) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const state = await runWorkspace(cwd, positional[1], {
        resume: tokens.includes('--resume'),
        dryRun,
        maxConcurrency: numberOption(tokens, '--max-concurrency', 4),
        maxTurns: numberOption(tokens, '--max-turns', 30),
        skipPermissions: tokens.includes('--skip-permissions'),
      })
      if (state.status !== 'completed') process.exitCode = 1
      return {
        type: 'text',
        value: json ? JSON.stringify(state, null, 2) : formatState(state),
      }
    }
    if (action === 'status') {
      if (!positional[1]) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const state = loadWorkspaceState(cwd, positional[1])
      if (!state || state.status === 'failed') process.exitCode = 1
      return {
        type: 'text',
        value: state
          ? json
            ? JSON.stringify(state, null, 2)
            : formatState(state)
          : `No workspace run exists: ${positional[1]}`,
      }
    }
    if (action === 'verify') {
      if (!positional[1]) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const state = await verifyWorkspace(cwd, positional[1])
      if (
        state.status !== 'completed' ||
        state.repositories.some(repo =>
          repo.verification.some(result => result.code !== 0),
        )
      ) {
        process.exitCode = 1
      }
      return {
        type: 'text',
        value: json
          ? JSON.stringify(state, null, 2)
          : [
              formatState(state),
              ...state.repositories.flatMap(repo =>
                repo.verification.map(
                  result =>
                    `  verify ${repo.id} [${result.code === 0 ? 'PASS' : 'FAIL'}]: ${result.command}`,
                ),
              ),
            ].join('\n'),
      }
    }
    if (action === 'pr-plan') {
      if (!positional[1]) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const plan = await generateWorkspacePrPlan(cwd, positional[1])
      return {
        type: 'text',
        value: json
          ? JSON.stringify(plan, null, 2)
          : [
              'PR plan only; no commands were executed:',
              ...plan.map(
                item =>
                  `${item.repository}${item.dependsOn.length ? ` (after ${item.dependsOn.join(', ')})` : ''}:\n${item.commands.map(command => `  ${command}`).join('\n')}`,
              ),
            ].join('\n'),
      }
    }
    if (action === 'rollback-plan') {
      if (!positional[1]) {
        process.exitCode = 1
        return { type: 'text', value: usage() }
      }
      const plan = generateWorkspaceRollbackPlan(cwd, positional[1])
      return {
        type: 'text',
        value: json
          ? JSON.stringify(plan, null, 2)
          : [
              'Rollback plan only; no commands were executed:',
              ...plan.flatMap(item => [
                `${item.repository}:`,
                ...item.commands.map(command => `  ${command}`),
              ]),
            ].join('\n'),
      }
    }
    process.exitCode = 1
    return { type: 'text', value: usage() }
  } catch (error) {
    process.exitCode = 1
    return {
      type: 'text',
      value: `Workspace error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
