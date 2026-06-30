import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { errorMessage } from '../../utils/errors.js'
import {
  backgroundDir,
  listBackgroundTasks,
  type BackgroundTask,
} from '../../services/agents/backgroundRunner.js'
import { findGitRoot, gitExe } from '../../utils/git.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { readdir, rm } from 'fs/promises'
import { join } from 'path'

function usage(): string {
  return [
    'Usage:',
    '  ur worktree list [--json]',
    '  ur worktree status <id> [--json]',
    '  ur worktree clean [--dry-run]',
  ].join('\n')
}

function formatWorktreeList(tasks: BackgroundTask[], json: boolean): string {
  const worktrees = tasks
    .filter(t => t.worktree?.enabled && t.worktree?.path)
    .map(t => ({
      id: t.id,
      status: t.status,
      branch: t.branch,
      path: t.worktree!.path,
      pr: t.pr?.enabled ? (t.pr.created ? 'created' : t.pr.error ? `failed (${t.pr.error})` : 'pending') : undefined,
    }))
  if (json) return JSON.stringify({ worktrees }, null, 2)
  if (worktrees.length === 0) return 'No active agent worktrees.'
  return [
    'UR agent worktrees',
    '',
    ...worktrees.map(w => `- ${w.id} [${w.status}] ${w.branch}\n  ${w.path}${w.pr ? `\n  pr: ${w.pr}` : ''}`),
  ].join('\n')
}

async function git(cwd: string, args: string[], timeout = 60_000): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return execFileNoThrowWithCwd(gitExe(), args, { cwd, timeout, preserveOutputOnError: true })
}

async function listWorktrees(cwd: string): Promise<string> {
  const root = findGitRoot(cwd)
  if (!root) return 'Not inside a git repository.'
  const result = await git(root, ['worktree', 'list', '--porcelain'])
  if (result.code !== 0) return `Failed to list worktrees: ${result.stderr || result.error}`
  const urWorktrees = result.stdout
    .split('\n\n')
    .filter(block => block.includes('.ur/worktrees/') || block.includes('/.ur/'))
  if (urWorktrees.length === 0) return 'No UR worktrees found in git worktree list.'
  return ['UR worktrees (git worktree list)', '', ...urWorktrees].join('\n')
}

async function removeWorktreePath(cwd: string, path: string): Promise<string> {
  const root = findGitRoot(cwd)
  if (!root) return 'Not inside a git repository.'
  const remove = await git(root, ['worktree', 'remove', path], 120_000)
  if (remove.code !== 0) {
    // If remove fails (e.g., dirty), try force remove
    const force = await git(root, ['worktree', 'remove', '--force', path], 120_000)
    if (force.code !== 0) return `Failed to remove worktree ${path}: ${force.stderr || force.error}`
  }
  return `Removed worktree ${path}`
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const dryRun = tokens.includes('--dry-run')
  const pos = tokens.filter(t => !t.startsWith('--'))
  const action = pos[0] ?? 'list'

  if (action === 'list' || action === 'ls') {
    return { type: 'text', value: formatWorktreeList(listBackgroundTasks(cwd), json) }
  }

  if (action === 'status' || action === 'show') {
    const id = pos[1]
    if (!id) return { type: 'text', value: usage() }
    const tasks = listBackgroundTasks(cwd)
    const task = tasks.find(t => t.id === id || t.worktree?.path?.includes(id))
    if (!task) return { type: 'text', value: `No worktree found matching "${id}".` }
    if (json) return { type: 'text', value: JSON.stringify(task, null, 2) }
    return {
      type: 'text',
      value: [
        `Task: ${task.id} [${task.status}]`,
        `Branch: ${task.branch ?? 'none'}`,
        `Worktree: ${task.worktree?.path ?? 'none'}`,
        `Log: ${task.logFile}`,
        task.pr?.enabled
          ? `PR: ${task.pr.created ? 'created' : task.pr.error ? `failed (${task.pr.error})` : 'pending'}`
          : 'PR: disabled',
      ].join('\n'),
    }
  }

  if (action === 'clean') {
    const tasks = listBackgroundTasks(cwd)
    const removable = tasks.filter(
      t =>
        t.worktree?.path &&
        (t.status === 'completed' || t.status === 'failed' || t.status === 'canceled'),
    )
    if (removable.length === 0) return { type: 'text', value: 'No completed/failed/canceled worktrees to clean.' }
    if (dryRun) {
      return {
        type: 'text',
        value: ['Would clean worktrees:', ...removable.map(t => `- ${t.id}: ${t.worktree!.path}`)].join('\n'),
      }
    }
    const results: string[] = []
    for (const task of removable) {
      try {
        const path = task.worktree!.path!
        const gitRemove = await removeWorktreePath(cwd, path)
        results.push(gitRemove)
        // Also remove the .ur/worktrees/<branch> directory if anything remains
        try {
          await rm(path, { recursive: true, force: true })
        } catch {
          // ignore
        }
      } catch (e) {
        results.push(`Failed to clean ${task.id}: ${errorMessage(e)}`)
      }
    }
    return { type: 'text', value: ['Cleaned worktrees:', ...results].join('\n') }
  }

  return { type: 'text', value: usage() }
}
