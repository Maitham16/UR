import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { getCwd } from '../../utils/cwd.js'
import { getDefaultBranch, gitExe } from '../../utils/git.js'
import { getTaskListId, listTasks, type Task } from '../../utils/tasks.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import {
  hasBlockingFindings,
  reviewDiff,
  summarizeFindings,
  type ReviewFinding,
} from './selfReview.js'
import {
  guardrailFindings,
  loadGuardrails,
} from '../../services/guardrails/guardrails.js'

type GitStatus = {
  isGit: boolean
  branch?: string
  status?: string
  diffStat?: string
  error?: string
}

type PrResult = {
  created: boolean
  dryRun: boolean
  command: string[]
  exitCode?: number
  stdout?: string
  stderr?: string
  error?: string
}

async function git(args: string[]): Promise<{ stdout: string; code: number }> {
  return execFileNoThrowWithCwd(gitExe(), args, {
    cwd: getCwd(),
    timeout: 10_000,
    preserveOutputOnError: true,
  })
}

async function exec(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return execFileNoThrowWithCwd(file, args, {
    cwd: getCwd(),
    timeout: 60_000,
    preserveOutputOnError: true,
  })
}

async function refExists(ref: string): Promise<boolean> {
  const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  return r.code === 0
}

/**
 * Resolve a base ref that actually exists. `getDefaultBranch()` can return a
 * name (e.g. "main") that isn't present in a repo using "master" or with no
 * remote, which would silently skip the branch diff — so try several
 * candidates and verify each resolves to a commit.
 */
async function resolveBaseRef(explicit?: string): Promise<string | undefined> {
  const head = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  const candidates: string[] = []
  if (explicit) candidates.push(explicit)
  const def = await getDefaultBranch().catch(() => undefined)
  if (def) candidates.push(def, `origin/${def}`)
  candidates.push('origin/HEAD', 'main', 'master', 'origin/main', 'origin/master')
  for (const ref of candidates) {
    if (!ref || ref === head) continue
    if (await refExists(ref)) return ref
  }
  return undefined
}

/**
 * Collect everything that would land in the PR, to self-review before opening
 * it: the branch's net diff against its base, uncommitted changes to tracked
 * files, and new untracked files (which `git diff HEAD` omits). Refs that don't
 * resolve are skipped rather than failing the gate.
 */
async function getReviewDiff(base?: string): Promise<string> {
  const parts: string[] = []

  // Committed changes on this branch vs its base.
  const baseRef = await resolveBaseRef(base)
  if (baseRef) {
    const branchDiff = await git(['diff', `${baseRef}...HEAD`])
    if (branchDiff.code === 0 && branchDiff.stdout.trim()) {
      parts.push(branchDiff.stdout)
    }
  }

  // Uncommitted changes to tracked files.
  const uncommitted = await git(['diff', 'HEAD'])
  if (uncommitted.code === 0 && uncommitted.stdout.trim()) {
    parts.push(uncommitted.stdout)
  }

  // New untracked files (honoring .gitignore). `git diff HEAD` never shows
  // these, so a brand-new file with a secret would otherwise slip past.
  const untracked = await git(['ls-files', '--others', '--exclude-standard'])
  if (untracked.code === 0 && untracked.stdout.trim()) {
    const files = untracked.stdout
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 200)
    for (const file of files) {
      const d = await git(['diff', '--no-index', '--', '/dev/null', file])
      if (d.stdout.trim()) {
        parts.push(d.stdout)
      }
    }
  }

  return parts.join('\n')
}

async function getGitStatus(): Promise<GitStatus> {
  const root = await git(['rev-parse', '--show-toplevel'])
  if (root.code !== 0) {
    return { isGit: false, error: 'Current directory is not a git repository.' }
  }
  const [branch, status, diffStat] = await Promise.all([
    git(['branch', '--show-current']),
    git(['status', '--short']),
    git(['diff', '--stat']),
  ])
  return {
    isGit: true,
    branch: branch.stdout.trim() || 'detached-head',
    status: status.stdout.trim(),
    diffStat: diffStat.stdout.trim(),
  }
}

function countTasks(tasks: Task[]): Record<Task['status'], number> {
  return tasks.reduce(
    (counts, task) => {
      counts[task.status] += 1
      return counts
    },
    { pending: 0, in_progress: 0, completed: 0, failed: 0, skipped: 0 },
  )
}

function formatTaskTable(tasks: Task[]): string {
  if (tasks.length === 0) return 'No tasks in the current task list.'
  return tasks
    .map(task => {
      const owner = task.owner ? ` owner=${task.owner}` : ''
      const blocked = task.blockedBy.length
        ? ` blockedBy=${task.blockedBy.join(',')}`
        : ''
      return `- ${task.id} [${task.status}] ${task.subject}${owner}${blocked}`
    })
    .join('\n')
}

async function collectState(): Promise<{
  taskListId: string
  tasks: Task[]
  counts: Record<Task['status'], number>
  git: GitStatus
}> {
  const taskListId = getTaskListId()
  const [tasks, gitStatus] = await Promise.all([
    listTasks(taskListId),
    getGitStatus(),
  ])
  return {
    taskListId,
    tasks,
    counts: countTasks(tasks),
    git: gitStatus,
  }
}

function formatStatus(state: Awaited<ReturnType<typeof collectState>>): string {
  const lines = [
    'Agent task status',
    `Task list: ${state.taskListId}`,
    `Counts: ${state.counts.pending} pending, ${state.counts.in_progress} in progress, ${state.counts.completed} completed`,
    '',
    formatTaskTable(state.tasks),
    '',
  ]

  if (state.git.isGit) {
    lines.push(`Branch: ${state.git.branch}`)
    lines.push(
      state.git.status
        ? `Working tree changes:\n${state.git.status}`
        : 'Working tree changes: clean',
    )
  } else {
    lines.push(state.git.error ?? 'Git status unavailable.')
  }
  return lines.join('\n')
}

function formatDiff(gitStatus: GitStatus): string {
  if (!gitStatus.isGit) return gitStatus.error ?? 'Git status unavailable.'
  return [
    `Branch: ${gitStatus.branch}`,
    gitStatus.status
      ? `Working tree changes:\n${gitStatus.status}`
      : 'Working tree changes: clean',
    '',
    gitStatus.diffStat ? `Diff stat:\n${gitStatus.diffStat}` : 'Diff stat: no unstaged diff',
  ].join('\n')
}

function formatPrHandoff(state: Awaited<ReturnType<typeof collectState>>): string {
  const lines = ['PR handoff', '']
  if (!state.git.isGit) {
    lines.push(state.git.error ?? 'Git status unavailable.')
    return lines.join('\n')
  }
  lines.push(`Branch: ${state.git.branch}`)
  lines.push(
    state.git.status
      ? `Working tree changes:\n${state.git.status}`
      : 'Working tree changes: clean',
  )
  lines.push('')
  lines.push('Suggested commands:')
  lines.push('  git status --short')
  lines.push('  git diff --stat')
  lines.push('  gh pr create --fill')
  lines.push('  ur agent-task pr --create')
  lines.push('')
  lines.push('Task summary:')
  lines.push(formatTaskTable(state.tasks))
  return lines.join('\n')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  if (index === -1) return undefined
  return tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const flagsWithValue = new Set(['--base', '--title', '--body'])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (flagsWithValue.has(token)) {
      i++
      continue
    }
    if (!token.startsWith('--')) {
      values.push(token)
    }
  }
  return values
}

function quoteArg(arg: string): string {
  return /^[a-zA-Z0-9_./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg)
}

function formatPrResult(result: PrResult): string {
  if (result.error) return result.error
  const lines = [
    result.dryRun
      ? 'PR dry run'
      : result.created
        ? 'PR created'
        : `PR create failed with exit ${result.exitCode ?? 'unknown'}`,
    `Command: ${result.command.map(quoteArg).join(' ')}`,
  ]
  if (result.stdout?.trim()) lines.push(`Stdout:\n${result.stdout.trim()}`)
  if (result.stderr?.trim()) lines.push(`Stderr:\n${result.stderr.trim()}`)
  return lines.join('\n')
}

async function createPr(
  state: Awaited<ReturnType<typeof collectState>>,
  tokens: string[],
): Promise<PrResult> {
  if (!state.git.isGit) {
    return {
      created: false,
      dryRun: false,
      command: [],
      error: state.git.error ?? 'Current directory is not a git repository.',
    }
  }
  if (!state.git.branch || state.git.branch === 'detached-head') {
    return {
      created: false,
      dryRun: false,
      command: [],
      error: 'Cannot create a PR from detached HEAD. Check out a branch first.',
    }
  }

  const args = ['pr', 'create']
  const title = option(tokens, '--title')
  const body = option(tokens, '--body')
  const base = option(tokens, '--base')
  if (title) args.push('--title', title)
  if (body) args.push('--body', body)
  if (base) args.push('--base', base)
  if (tokens.includes('--draft')) args.push('--draft')
  if (!title && !body) args.push('--fill')

  const command = ['gh', ...args]
  if (tokens.includes('--dry-run')) {
    return { created: false, dryRun: true, command }
  }

  const gh = await exec('gh', ['--version'])
  if (gh.code !== 0) {
    return {
      created: false,
      dryRun: false,
      command,
      error: 'GitHub CLI is not available. Install `gh` or use the printed handoff command.',
      stderr: gh.stderr,
    }
  }

  const result = await exec('gh', args)
  return {
    created: result.code === 0,
    dryRun: false,
    command,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr || result.error,
  }
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const positional = positionals(tokens)
  const command = positional[0] ?? 'status'
  const state = await collectState()

  if (command === 'pr' && tokens.includes('--create')) {
    // Self-review gate: review the diff before opening the PR. Blocking
    // findings (conflict markers, secrets, focused tests) abort creation
    // unless --force or --no-review is passed.
    let review: ReviewFinding[] | undefined
    if (!tokens.includes('--no-review')) {
      const diff = await getReviewDiff(option(tokens, '--base'))
      // Self-review heuristics plus the declarative guardrails layer
      // (.ur/guardrails/) — both can produce blocking findings.
      review = [...reviewDiff(diff), ...guardrailFindings(diff, loadGuardrails(getCwd()))]
      if (hasBlockingFindings(review) && !tokens.includes('--force')) {
        const summary = summarizeFindings(review)
        return {
          type: 'text',
          value: json
            ? JSON.stringify({ state, review, prCreated: false, blocked: true }, null, 2)
            : `PR creation blocked by self-review.\n\n${summary}\n\nFix these issues, or re-run with --force to override or --no-review to skip.`,
        }
      }
    }

    const pr = await createPr(state, tokens)
    if (json) {
      return {
        type: 'text',
        value: JSON.stringify({ state, review, pr }, null, 2),
      }
    }
    const reviewText =
      review && review.length > 0 ? `${summarizeFindings(review)}\n\n` : ''
    return { type: 'text', value: `${reviewText}${formatPrResult(pr)}` }
  }

  if (json) {
    return { type: 'text', value: JSON.stringify(state, null, 2) }
  }

  if (command === 'status') {
    return { type: 'text', value: formatStatus(state) }
  }
  if (command === 'diff') {
    return { type: 'text', value: formatDiff(state.git) }
  }
  if (command === 'pr') {
    return { type: 'text', value: formatPrHandoff(state) }
  }

  return {
    type: 'text',
    value:
      'Usage: ur agent-task status|diff|pr [--json]\n       ur agent-task pr --create [--draft] [--base main] [--title text] [--body text] [--dry-run]\n       (pr --create runs a self-review gate first; use --force to override blocking findings or --no-review to skip)',
  }
}
