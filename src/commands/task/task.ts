/**
 * `ur task` command.
 *
 * Worktree-per-task support:
 *   ur task start fix-auth --worktree
 *   ur task run <id>
 *   ur task pr <id>
 *
 * Wraps the existing background agent runner so every task can get its own
 * branch and worktree for safe parallel work and clean review.
 */

import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { findGitRoot, getDefaultBranch, gitExe } from '../../utils/git.js'
import {
  createBackgroundTask,
  getBackgroundTask,
  listBackgroundTasks,
  startExistingBackgroundTask,
  type BackgroundTask,
} from '../../services/agents/backgroundRunner.js'
import { buildPrSummary, formatPrSummary } from '../../services/agents/prSummary.js'

function usage(): string {
  return [
    'Usage:',
    '  ur task start <name> [--worktree] [--base <branch>] [--model <model>] [--max-turns <n>] [--json]',
    '  ur task run <id> [--dry-run] [--json]',
    '  ur task pr <id> [--create] [--draft] [--base <branch>] [--title <text>] [--body <text>] [--dry-run] [--json]',
    '  ur task list [--json]',
    '  ur task status <id> [--json]',
  ].join('\n')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const flagsWithValue = new Set(['--base', '--title', '--body', '--model', '--max-turns'])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (flagsWithValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

async function git(cwd: string, args: string[], timeout = 60_000): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return execFileNoThrowWithCwd(gitExe(), args, { cwd, timeout, preserveOutputOnError: true })
}

async function resolveBase(cwd: string, explicit?: string): Promise<string | undefined> {
  const head = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  const candidates = explicit ? [explicit] : []
  const def = await getDefaultBranch().catch(() => undefined)
  if (def) candidates.push(def, `origin/${def}`)
  candidates.push('origin/HEAD', 'main', 'master', 'origin/main', 'origin/master')
  for (const ref of candidates) {
    if (!ref || ref === head) continue
    const r = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (r.code === 0) return ref
  }
  return undefined
}

function formatTask(task: BackgroundTask, json: boolean): string {
  if (json) return JSON.stringify(task, null, 2)
  const lines = [
    `Task: ${task.id}`,
    `Status: ${task.status}`,
    `Branch: ${task.branch ?? 'none'}`,
    `Worktree: ${task.worktree?.enabled ? task.worktree.path : 'disabled'}`,
    `Model: ${task.model ?? 'default'}`,
    `Log: ${task.logFile}`,
  ]
  if (task.pr?.enabled) {
    lines.push(
      `PR: ${task.pr.created ? 'created' : task.pr.error ? `failed (${task.pr.error})` : 'pending'}`
    )
  }
  return lines.join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const pos = positionals(tokens)
  const action = pos[0] ?? 'list'
  const cwd = getCwd()

  if (action === 'start') {
    const name = pos[1]
    if (!name) return { type: 'text', value: usage() }
    if (!findGitRoot(cwd)) {
      return { type: 'text', value: 'task start requires a git repository.' }
    }
    const base = await resolveBase(cwd, option(tokens, '--base'))
    const worktree = tokens.includes('--worktree')
    const model = option(tokens, '--model')
    const maxTurns = option(tokens, '--max-turns')
    const task = createBackgroundTask({
      cwd,
      task: name,
      worktree,
      pr: worktree,
      base,
      title: `UR task: ${name}`,
      body: `This change was produced by \`ur task start ${name}\` running in an isolated UR worktree.`,
      model,
      maxTurns: maxTurns ? parseInt(maxTurns, 10) : undefined,
    })
    return { type: 'text', value: formatTask(task, json) }
  }

  if (action === 'run') {
    const id = pos[1]
    if (!id) return { type: 'text', value: usage() }
    const existing = getBackgroundTask(cwd, id) ?? listBackgroundTasks(cwd).find(t => t.id.startsWith(id))
    if (!existing) return { type: 'text', value: `Task ${id} not found.` }
    const result = startExistingBackgroundTask(cwd, existing.id, {
      dryRun: tokens.includes('--dry-run'),
    })
    if (!result) return { type: 'text', value: `Task ${id} not found.` }
    const task = result.task
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ task, command: result.command }, null, 2)
        : `${result.dryRun ? 'Would start' : 'Started'} task ${task.id}\nCommand: ${result.command.join(' ')}\nLog: ${task.logFile}`,
    }
  }

  if (action === 'pr') {
    const id = pos[1]
    if (!id) return { type: 'text', value: usage() }
    const task = getBackgroundTask(cwd, id)
    if (!task) return { type: 'text', value: `Task ${id} not found.` }
    const worktreePath = task.worktree?.path
    if (!worktreePath) {
      return { type: 'text', value: `Task ${id} was not started with a worktree; cannot create PR.` }
    }
    const base = option(tokens, '--base') ?? task.pr?.base ?? 'HEAD'
    const title = option(tokens, '--title') ?? task.pr?.title ?? `UR task: ${task.task}`
    const body = option(tokens, '--body') ?? task.pr?.body ?? ''
    const draft = tokens.includes('--draft')

    if (tokens.includes('--create')) {
      const dryRun = tokens.includes('--dry-run')
      const args = ['pr', 'create', '--title', title, '--body', body]
      if (base) args.push('--base', base)
      if (draft) args.push('--draft')
      if (dryRun) {
        const summary = await buildPrSummary({ cwd: worktreePath, title, description: body, base })
        return {
          type: 'text',
          value: json
            ? JSON.stringify({ dryRun: true, command: ['gh', ...args], summary }, null, 2)
            : `Dry run: gh ${args.map(a => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}\n\n${formatPrSummary(summary)}`,
        }
      }
      const pr = await execFileNoThrowWithCwd('gh', args, { cwd: worktreePath, timeout: 5 * 60 * 1000, preserveOutputOnError: true })
      const summary = await buildPrSummary({ cwd: worktreePath, title, description: body, base })
      const result = { pr, summary }
      return {
        type: 'text',
        value: json
          ? JSON.stringify(result, null, 2)
          : `${formatPrSummary(summary)}\n\nPR create ${pr.code === 0 ? 'succeeded' : 'failed'}:\n${pr.stdout}\n${pr.stderr || ''}`.trim(),
      }
    }

    // preview mode
    const summary = await buildPrSummary({ cwd: worktreePath, title, description: body, base })
    return { type: 'text', value: json ? JSON.stringify(summary, null, 2) : formatPrSummary(summary) }
  }

  if (action === 'list') {
    const tasks = listBackgroundTasks(cwd)
    if (json) return { type: 'text', value: JSON.stringify({ tasks }, null, 2) }
    if (tasks.length === 0) return { type: 'text', value: 'No tasks.' }
    return { type: 'text', value: tasks.map(t => `- ${t.id} [${t.status}] ${t.task}${t.branch ? ` (${t.branch})` : ''}`).join('\n') }
  }

  if (action === 'status') {
    const id = pos[1]
    if (!id) return { type: 'text', value: usage() }
    const task = getBackgroundTask(cwd, id) ?? listBackgroundTasks(cwd).find(t => t.id.startsWith(id))
    if (!task) return { type: 'text', value: `Task ${id} not found.` }
    return { type: 'text', value: formatTask(task, json) }
  }

  return { type: 'text', value: usage() }
}
