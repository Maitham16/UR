import {
  createBackgroundTask,
  createPullRequest,
  getBackgroundTask,
  startBackgroundTask,
  type StartBackgroundTaskResult,
} from './backgroundRunner.js'

export type AgentSkillSummary = {
  taskId: string
  branch: string
  commits: string[]
  prUrl?: string
  prCreated: boolean
  prError?: string
  diffSummary: string
  worktreePath?: string
}

export type AgentSkillOptions = {
  cwd: string
  skill: string
  prompt: string
  prTitle?: string
  prBody?: string
  base?: string
  draft?: boolean
  model?: string
  maxTurns?: number
  dryRun?: boolean
  bin?: { file: string; baseArgs: string[] }
  pollMs?: number
  timeoutMs?: number
  /** Publishing is opt-in; worktree skills never create a PR by default. */
  createPr?: boolean
}

function nowMs(): number {
  return Date.now()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function diffSummary(cwd: string, branch?: string): Promise<string> {
  try {
    const { execFileNoThrowWithCwd } = await import('../../utils/execFileNoThrow.js')
    const result =
      branch
        ? await execFileNoThrowWithCwd(
            'git',
            ['diff', '--stat', `origin/${branch}..${branch}`],
            { cwd, timeout: 30_000, preserveOutputOnError: true },
          )
        : await execFileNoThrowWithCwd('git', ['diff', '--stat'], {
            cwd,
            timeout: 30_000,
            preserveOutputOnError: true,
          })
    return result.code === 0 && result.stdout.trim()
      ? result.stdout.trim()
      : 'No diff stats available.'
  } catch {
    return 'No diff stats available.'
  }
}

async function listCommits(cwd: string, branch?: string): Promise<string[]> {
  try {
    const { execFileNoThrowWithCwd } = await import('../../utils/execFileNoThrow.js')
    const result = await execFileNoThrowWithCwd(
      'git',
      ['log', '--oneline', '--no-decorate', branch ? `${branch}` : 'HEAD', '-20'],
      { cwd, timeout: 30_000, preserveOutputOnError: true },
    )
    if (result.code !== 0 || !result.stdout.trim()) return []
    return result.stdout.trim().split('\n')
  } catch {
    return []
  }
}

function extractPrUrl(stdout: string): string | undefined {
  const match = stdout.match(/https:\/\/github\.com\/[^\s]+/)
  return match?.[0]
}

/**
 * Run an agent skill in an isolated worktree with an optional PR handoff.
 *
 * PR creation is enabled only when the caller explicitly sets `createPr: true`.
 * It starts the background task, polls the manifest until completion, and returns a summary
 * with branch name, commits, PR URL (if created), diff summary, and any error.
 */
export async function runAgentSkill(options: AgentSkillOptions): Promise<AgentSkillSummary> {
  const {
    cwd,
    skill,
    prompt,
    prTitle,
    prBody,
    base,
    draft,
    model,
    maxTurns,
    dryRun,
    bin,
    pollMs = 2000,
    timeoutMs = 30 * 60 * 1000,
    createPr = false,
  } = options

  const title = prTitle ?? `UR agent skill: ${skill}`
  const body =
    prBody ??
    `This change was produced by the /${skill} agent skill running in an isolated UR worktree.`

  const startResult: StartBackgroundTaskResult = await startBackgroundTask({
    cwd,
    task: prompt,
    worktree: true,
    pr: createPr,
    title,
    body,
    base,
    draft,
    model,
    maxTurns,
    dryRun,
    bin,
  })

  const task = startResult.task
  const startedAt = nowMs()

  if (dryRun) {
    return {
      taskId: task.id,
      branch: task.branch ?? `ur/bg-${task.id}-${skill}`,
      commits: [],
      prCreated: false,
      diffSummary: `Dry run command: ${startResult.command.join(' ')}`,
      worktreePath: task.worktree?.path,
    }
  }

  for (;;) {
    await sleep(pollMs)
    const current = getBackgroundTask(cwd, task.id)
    if (!current) {
      return {
        taskId: task.id,
        branch: task.branch ?? `ur/bg-${task.id}-${skill}`,
        commits: [],
        prCreated: false,
        prError: 'Task disappeared from manifest',
        diffSummary: 'Task disappeared from manifest',
        worktreePath: task.worktree?.path,
      }
    }
    if (current.status === 'completed' || current.status === 'failed' || current.status === 'canceled') {
      const worktreePath = current.worktree?.path ?? task.worktree?.path
      const branch = current.branch ?? task.branch ?? `ur/bg-${task.id}-${skill}`
      let pr = current.pr
      if (
        current.status === 'completed' &&
        pr?.enabled &&
        pr.created !== true &&
        !pr.error &&
        worktreePath
      ) {
        pr = await createPullRequest(current, worktreePath)
      }
      const commits = worktreePath ? await listCommits(worktreePath, branch) : []
      const summary = worktreePath
        ? await diffSummary(worktreePath, branch)
        : 'No worktree path available.'
      return {
        taskId: current.id,
        branch,
        commits,
        prUrl: pr?.created ? extractPrUrl(pr.stdout ?? '') : undefined,
        prCreated: pr?.created === true,
        prError: pr?.error,
        diffSummary: summary,
        worktreePath,
      }
    }
    if (nowMs() - startedAt > timeoutMs) {
      return {
        taskId: task.id,
        branch: task.branch ?? `ur/bg-${task.id}-${skill}`,
        commits: [],
        prCreated: false,
        prError: `Timed out after ${timeoutMs}ms`,
        diffSummary: 'Timed out waiting for agent skill to complete',
        worktreePath: task.worktree?.path,
      }
    }
  }
}

/**
 * Create a background task record for an agent skill without launching it.
 * Useful for dry-run previews and CLI output formatting.
 */
export function previewAgentSkill(options: AgentSkillOptions): { id: string; command: string[]; branch: string } {
  const { cwd, skill, prompt, prTitle, prBody, base, draft, model, maxTurns, bin, createPr = false } = options
  const task = createBackgroundTask({
    cwd,
    task: prompt,
    worktree: true,
    pr: createPr,
    title: prTitle ?? `UR agent skill: ${skill}`,
    body: prBody ?? `This change was produced by the /${skill} agent skill running in an isolated UR worktree.`,
    base,
    draft,
    model,
    maxTurns,
    bin,
  })
  const entry = bin ?? {
    file: process.execPath,
    baseArgs: [process.argv[1] ?? ''],
  }
  return {
    id: task.id,
    command: [entry.file, ...entry.baseArgs, 'bg', 'worker', task.id],
    branch: task.branch ?? `ur/bg-${task.id}-${skill}`,
  }
}
