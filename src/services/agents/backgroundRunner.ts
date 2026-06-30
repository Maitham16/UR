import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { findCanonicalGitRoot, findGitRoot, gitExe } from '../../utils/git.js'
import { safeParseJSON } from '../../utils/json.js'
import { listModelCapabilities } from '../../commands/model-doctor/model-doctor.js'
import { resolveModelForTask } from './modelRouter.js'
import { loadModelPool } from './modelPool.js'

export type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'

export type BackgroundTask = {
  id: string
  task: string
  status: BackgroundTaskStatus
  cwd: string
  runCwd: string
  model?: string
  maxTurns?: number
  skipPermissions?: boolean
  workerPid?: number
  agentPid?: number
  exitCode?: number
  error?: string
  logFile: string
  outputFile: string
  inboxFile: string
  branch?: string
  worktree?: {
    enabled: boolean
    path?: string
    branch?: string
  }
  pr?: {
    enabled: boolean
    draft?: boolean
    base?: string
    title?: string
    body?: string
    push?: boolean
    command?: string[]
    created?: boolean
    stdout?: string
    stderr?: string
    error?: string
  }
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

type Manifest = { version: 1; tasks: BackgroundTask[] }

export type StartBackgroundTaskOptions = {
  cwd: string
  task: string
  worktree?: boolean
  pr?: boolean
  draft?: boolean
  base?: string
  title?: string
  body?: string
  push?: boolean
  model?: string
  routeStrategy?: 'auto' | 'cheap' | 'strong' | 'default'
  maxTurns?: number
  skipPermissions?: boolean
  dryRun?: boolean
  bin?: { file: string; baseArgs: string[] }
}

export type FanoutBackgroundOptions = StartBackgroundTaskOptions & {
  agents: number
}

export type StartBackgroundTaskResult = {
  task: BackgroundTask
  command: string[]
  dryRun: boolean
}

export type StartExistingBackgroundTaskOptions = {
  dryRun?: boolean
  bin?: { file: string; baseArgs: string[] }
}

function now(): string {
  return new Date().toISOString()
}

function projectRoot(cwd: string): string {
  return findCanonicalGitRoot(cwd) ?? findGitRoot(cwd) ?? cwd
}

export function backgroundDir(cwd: string): string {
  return join(projectRoot(cwd), '.ur', 'background')
}

function manifestPath(cwd: string): string {
  return join(backgroundDir(cwd), 'tasks.json')
}

function logsDir(cwd: string): string {
  return join(backgroundDir(cwd), 'logs')
}

function outputsDir(cwd: string): string {
  return join(backgroundDir(cwd), 'outputs')
}

function inboxDir(cwd: string): string {
  return join(backgroundDir(cwd), 'inbox')
}

function worktreesDir(cwd: string): string {
  return join(projectRoot(cwd), '.ur', 'worktrees')
}

function ensureDirs(cwd: string): void {
  mkdirSync(backgroundDir(cwd), { recursive: true })
  mkdirSync(logsDir(cwd), { recursive: true })
  mkdirSync(outputsDir(cwd), { recursive: true })
  mkdirSync(inboxDir(cwd), { recursive: true })
}

function loadManifest(cwd: string): Manifest {
  const path = manifestPath(cwd)
  if (!existsSync(path)) return { version: 1, tasks: [] }
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object' && Array.isArray((parsed as Manifest).tasks)
    ? (parsed as Manifest)
    : { version: 1, tasks: [] }
}

function saveManifest(cwd: string, manifest: Manifest): void {
  ensureDirs(cwd)
  writeFileSync(manifestPath(cwd), `${JSON.stringify(manifest, null, 2)}\n`)
}

function updateTask(
  cwd: string,
  id: string,
  fn: (task: BackgroundTask) => void,
): BackgroundTask | null {
  const manifest = loadManifest(cwd)
  const task = manifest.tasks.find(t => t.id === id)
  if (!task) return null
  fn(task)
  task.updatedAt = now()
  saveManifest(cwd, manifest)
  return task
}

function makeId(): string {
  return `bg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'task'
}

function cliEntry(bin?: { file: string; baseArgs: string[] }): {
  file: string
  baseArgs: string[]
} {
  return {
    file: bin?.file ?? process.execPath,
    baseArgs: bin?.baseArgs ?? [process.argv[1] ?? ''],
  }
}

function quote(arg: string): string {
  return /^[a-zA-Z0-9_./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg)
}

export function listBackgroundTasks(cwd: string): BackgroundTask[] {
  return loadManifest(cwd).tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getBackgroundTask(cwd: string, id: string): BackgroundTask | null {
  return loadManifest(cwd).tasks.find(t => t.id === id) ?? null
}

export function readBackgroundLog(cwd: string, id: string, tailLines?: number): string | null {
  const task = getBackgroundTask(cwd, id)
  if (!task || !existsSync(task.logFile)) return null
  const text = readFileSync(task.logFile, 'utf-8')
  if (!tailLines || tailLines <= 0) return text
  return text.split('\n').slice(-tailLines).join('\n')
}

export function appendBackgroundFeedback(
  cwd: string,
  id: string,
  text: string,
  source?: { artifactId?: string },
): BackgroundTask | null {
  const task = getBackgroundTask(cwd, id)
  if (!task) return null
  const at = now()
  const entry = {
    at,
    type: 'artifact-feedback',
    artifactId: source?.artifactId,
    text,
  }
  writeFileSync(task.inboxFile, `${JSON.stringify(entry)}\n`, { flag: 'a' })
  writeFileSync(
    task.logFile,
    `[${at}] steering feedback${source?.artifactId ? ` from artifact ${source.artifactId}` : ''}: ${text}\n`,
    { flag: 'a' },
  )
  return updateTask(cwd, id, t => {
    t.updatedAt = at
  })
}

export function readBackgroundInbox(cwd: string, id: string): string | null {
  const task = getBackgroundTask(cwd, id)
  if (!task || !existsSync(task.inboxFile)) return null
  return readFileSync(task.inboxFile, 'utf-8')
}

export function createBackgroundTask(
  options: StartBackgroundTaskOptions,
): BackgroundTask {
  const root = projectRoot(options.cwd)
  ensureDirs(root)
  const id = makeId()
  const createdAt = now()
  const branch = options.worktree ? `ur/bg-${id}-${slug(options.task)}` : undefined
  const task: BackgroundTask = {
    id,
    task: options.task,
    status: 'queued',
    cwd: root,
    runCwd: root,
    model: options.model,
    maxTurns: options.maxTurns,
    skipPermissions: options.skipPermissions,
    logFile: join(logsDir(root), `${id}.log`),
    outputFile: join(outputsDir(root), `${id}.json`),
    inboxFile: join(inboxDir(root), `${id}.jsonl`),
    branch,
    worktree: options.worktree
      ? { enabled: true, branch, path: join(worktreesDir(root), branch ?? id) }
      : undefined,
    pr: options.pr
      ? {
          enabled: true,
          draft: options.draft,
          base: options.base,
          title: options.title,
          body: options.body,
          push: options.push ?? true,
        }
      : undefined,
    createdAt,
    updatedAt: createdAt,
  }
  const manifest = loadManifest(root)
  manifest.tasks.push(task)
  saveManifest(root, manifest)
  return task
}

function buildWorkerCommand(
  task: BackgroundTask,
  bin?: { file: string; baseArgs: string[] },
): { entry: { file: string; baseArgs: string[] }; command: string[] } {
  const entry = cliEntry(bin)
  return {
    entry,
    command: [...entry.baseArgs, 'bg', 'worker', task.id],
  }
}

async function resolveTaskEnv(task: BackgroundTask): Promise<NodeJS.ProcessEnv> {
  const base = { ...process.env }
  const model = task.model ?? (await resolveRouteStrategyModel(task))
  if (model) {
    base.UR_MODEL = model
    base.OLLAMA_MODEL = model
  }
  return base
}

async function resolveRouteStrategyModel(task: BackgroundTask): Promise<string | undefined> {
  // BackgroundTask stores only model today; route strategy is resolved here when caller sets it.
  const strategy = (task as { routeStrategy?: string }).routeStrategy
  if (!strategy) return undefined
  const { models } = await listModelCapabilities()
  return resolveModelForTask(task.task, strategy as import('./modelRouter.js').RouteStrategy, loadModelPool(task.cwd), models)
}

async function spawnBackgroundWorker(
  task: BackgroundTask,
  bin?: { file: string; baseArgs: string[] },
): Promise<string[]> {
  const { entry, command } = buildWorkerCommand(task, bin)
  const out = openSync(task.logFile, 'a')
  const err = openSync(task.logFile, 'a')
  try {
    const env = await resolveTaskEnv(task)
    const child = spawn(entry.file, command, {
      cwd: task.cwd,
      detached: true,
      stdio: ['ignore', out, err],
      env,
    })
    child.unref()
    updateTask(task.cwd, task.id, t => {
      t.workerPid = child.pid
    })
  } finally {
    closeSync(out)
    closeSync(err)
  }
  return [entry.file, ...command]
}

export async function startBackgroundTask(
  options: StartBackgroundTaskOptions,
): Promise<StartBackgroundTaskResult> {
  const task = createBackgroundTask(options)
  const { entry, command } = buildWorkerCommand(task, options.bin)
  if (options.dryRun) {
    return { task, command: [entry.file, ...command], dryRun: true }
  }

  await spawnBackgroundWorker(task, options.bin)

  return { task, command: [entry.file, ...command], dryRun: false }
}

export function startExistingBackgroundTask(
  cwd: string,
  id: string,
  options: StartExistingBackgroundTaskOptions = {},
): StartBackgroundTaskResult | null {
  const task = getBackgroundTask(cwd, id)
  if (!task) return null
  const { entry, command } = buildWorkerCommand(task, options.bin)
  if (options.dryRun) {
    return { task, command: [entry.file, ...command], dryRun: true }
  }
  spawnBackgroundWorker(task, options.bin)
  return { task, command: [entry.file, ...command], dryRun: false }
}

export async function fanoutBackgroundTasks(
  options: FanoutBackgroundOptions,
): Promise<StartBackgroundTaskResult[]> {
  const count = Math.max(1, Math.min(32, Math.floor(options.agents || 1)))
  const results: StartBackgroundTaskResult[] = []
  for (let i = 1; i <= count; i++) {
    results.push(
      await startBackgroundTask({
        ...options,
        task:
          count === 1
            ? options.task
            : `Candidate ${i}/${count}: ${options.task}`,
      }),
    )
  }
  return results
}

async function git(
  cwd: string,
  args: string[],
  timeout = 60_000,
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return execFileNoThrowWithCwd(gitExe(), args, {
    cwd,
    timeout,
    preserveOutputOnError: true,
  })
}

async function setupWorktree(task: BackgroundTask): Promise<string> {
  if (!task.worktree?.enabled) return task.cwd
  const path = resolve(task.worktree.path ?? join(worktreesDir(task.cwd), task.id))
  const branch = task.worktree.branch ?? `ur/bg-${task.id}`
  mkdirSync(worktreesDir(task.cwd), { recursive: true })
  if (!existsSync(path)) {
    const result = await git(task.cwd, ['worktree', 'add', '-b', branch, path, 'HEAD'], 120_000)
    if (result.code !== 0) {
      throw new Error(result.stderr || result.error || `git worktree add failed for ${path}`)
    }
  }
  updateTask(task.cwd, task.id, t => {
    t.runCwd = path
    t.worktree = { enabled: true, path, branch }
    t.branch = branch
  })
  return path
}

function childPrompt(task: BackgroundTask): string {
  const lines = [
    task.task,
    '',
    'UR background-agent instructions:',
    '- Work locally in this repository and keep UR identity intact.',
    '- Prefer small, reviewable commits and run relevant checks before finishing.',
    '- If this run has a worktree, do not touch the original checkout.',
  ]
  if (task.pr?.enabled) {
    lines.push(
      '- This run is expected to produce a pull request; leave the branch ready for PR creation.',
    )
  }
  lines.push(`- Background task id: ${task.id}`)
  lines.push(
    `- Live steering inbox: ${task.inboxFile}. If it exists or changes, incorporate the latest feedback before finalizing.`,
  )
  return lines.join('\n')
}

export function streamUserMessage(content: string, priority: 'now' | 'later' = 'later'): string {
  return `${JSON.stringify({
    type: 'user',
    session_id: '',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    priority,
  })}\n`
}

type InboxEntry = {
  at?: string
  type?: string
  artifactId?: string
  text?: string
}

export function formatInboxSteering(entry: InboxEntry): string | null {
  if (!entry.text?.trim()) return null
  const source = entry.artifactId ? ` on artifact ${entry.artifactId}` : ''
  return [
    `Live steering feedback${source}:`,
    entry.text.trim(),
    '',
    'Incorporate this feedback into the current background task. If you are in the middle of an approach that conflicts with this feedback, adjust course before finalizing.',
  ].join('\n')
}

export function readInboxEntriesFromOffset(file: string, offset: number): {
  nextOffset: number
  entries: InboxEntry[]
} {
  if (!existsSync(file)) return { nextOffset: offset, entries: [] }
  const size = statSync(file).size
  if (size <= offset) return { nextOffset: size, entries: [] }
  const text = readFileSync(file, 'utf-8').slice(offset)
  const entries: InboxEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = safeParseJSON(trimmed, false)
    if (parsed && typeof parsed === 'object') entries.push(parsed as InboxEntry)
  }
  return { nextOffset: size, entries }
}

async function runHeadlessAgent(task: BackgroundTask, cwd: string): Promise<number> {
  const entry = cliEntry()
  const args = [
    ...entry.baseArgs,
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
  ]
  if (task.maxTurns && task.maxTurns > 0) args.push('--max-turns', String(task.maxTurns))
  if (task.skipPermissions) args.push('--dangerously-skip-permissions')

  const env = task.model
    ? { ...process.env, UR_MODEL: task.model, OLLAMA_MODEL: task.model }
    : process.env

  return await new Promise(resolve => {
    const outputFd = openSync(task.outputFile, 'a')
    const logFd = openSync(task.logFile, 'a')
    let inboxOffset = existsSync(task.inboxFile) ? statSync(task.inboxFile).size : 0
    let sawResult = false
    let closedInput = false
    let cleanedUp = false
    let closeTimer: ReturnType<typeof setTimeout> | undefined

    const closeInputSoon = () => {
      if (closedInput) return
      if (closeTimer) clearTimeout(closeTimer)
      closeTimer = setTimeout(() => {
        if (closedInput) return
        closedInput = true
        child.stdin.end()
      }, 1000)
    }

    const writeSteering = (text: string) => {
      if (closedInput || child.stdin.destroyed) return
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = undefined
      }
      child.stdin.write(streamUserMessage(text, 'now'))
      writeFileSync(task.logFile, `[${now()}] injected live steering into agent stdin\n`, {
        flag: 'a',
      })
      sawResult = false
    }

    const pumpInbox = () => {
      const read = readInboxEntriesFromOffset(task.inboxFile, inboxOffset)
      inboxOffset = read.nextOffset
      for (const entry of read.entries) {
        const steering = formatInboxSteering(entry)
        if (steering) writeSteering(steering)
      }
      if (sawResult) closeInputSoon()
    }

    const child = spawn(entry.file, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
    updateTask(task.cwd, task.id, t => {
      t.agentPid = child.pid
    })
    child.stdin.write(streamUserMessage(childPrompt(task), 'later'))
    const interval = setInterval(pumpInbox, 500)

    let stdoutBuffer = ''
    child.stdout.on('data', chunk => {
      const text = Buffer.from(chunk).toString('utf-8')
      writeFileSync(outputFd, text)
      stdoutBuffer += text
      for (;;) {
        const newline = stdoutBuffer.indexOf('\n')
        if (newline === -1) break
        const line = stdoutBuffer.slice(0, newline)
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        const parsed = safeParseJSON(line, false)
        if (parsed && typeof parsed === 'object' && (parsed as { type?: string }).type === 'result') {
          sawResult = true
          pumpInbox()
        }
      }
    })
    child.stderr.on('data', chunk => {
      writeFileSync(logFd, Buffer.from(chunk).toString('utf-8'))
    })
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      clearInterval(interval)
      if (closeTimer) clearTimeout(closeTimer)
      closeSync(outputFd)
      closeSync(logFd)
    }

    child.on('error', error => {
      writeFileSync(task.logFile, `\n[agent spawn error] ${error.message}\n`, { flag: 'a' })
      cleanup()
      resolve(1)
    })
    child.on('close', code => {
      cleanup()
      resolve(code ?? 1)
    })
  })
}

export async function commitIfNeeded(task: BackgroundTask, cwd: string): Promise<void> {
  const status = await git(cwd, ['status', '--porcelain'])
  if (status.code !== 0 || !status.stdout.trim()) return
  await git(cwd, ['add', '-A'])
  const title = task.pr?.title ?? `UR background task ${task.id}`
  const commit = await git(cwd, ['commit', '-m', title], 120_000)
  if (commit.code !== 0) {
    throw new Error(commit.stderr || commit.error || 'git commit failed')
  }
}

export async function createPullRequest(task: BackgroundTask, cwd: string): Promise<BackgroundTask['pr']> {
  if (!task.pr?.enabled) return task.pr
  const pr = { ...task.pr }
  await commitIfNeeded(task, cwd)
  if (pr.push && task.branch) {
    const push = await git(cwd, ['push', '--set-upstream', 'origin', task.branch], 5 * 60_000)
    if (push.code !== 0) {
      return {
        ...pr,
        created: false,
        error: push.stderr || push.error || 'git push failed',
        stdout: push.stdout,
        stderr: push.stderr,
      }
    }
  }

  const args = ['pr', 'create']
  if (pr.title) args.push('--title', pr.title)
  if (pr.body) args.push('--body', pr.body)
  if (pr.base) args.push('--base', pr.base)
  if (pr.draft) args.push('--draft')
  if (!pr.title && !pr.body) args.push('--fill')

  const gh = await execFileNoThrowWithCwd('gh', args, {
    cwd,
    timeout: 5 * 60_000,
    preserveOutputOnError: true,
  })
  return {
    ...pr,
    command: ['gh', ...args],
    created: gh.code === 0,
    stdout: gh.stdout,
    stderr: gh.stderr || gh.error,
    error: gh.code === 0 ? undefined : gh.stderr || gh.error || 'gh pr create failed',
  }
}

export async function runBackgroundWorker(cwd: string, id: string): Promise<BackgroundTask> {
  const task = getBackgroundTask(cwd, id)
  if (!task) throw new Error(`Background task not found: ${id}`)
  writeFileSync(task.logFile, `[${now()}] worker started for ${id}\n`, { flag: 'a' })
  updateTask(task.cwd, task.id, t => {
    t.status = 'running'
    t.workerPid = process.pid
    t.startedAt = t.startedAt ?? now()
  })

  try {
    const runCwd = await setupWorktree(task)
    writeFileSync(task.logFile, `[${now()}] running in ${runCwd}\n`, { flag: 'a' })
    const exitCode = await runHeadlessAgent(task, runCwd)
    const pr = task.pr?.enabled ? await createPullRequest(task, runCwd) : task.pr
    const completed = updateTask(task.cwd, task.id, t => {
      t.exitCode = exitCode
      t.status = exitCode === 0 && (!pr?.enabled || pr.created !== false) ? 'completed' : 'failed'
      t.completedAt = now()
      if (pr) t.pr = pr
    })
    writeFileSync(task.logFile, `[${now()}] worker finished with exit ${exitCode}\n`, { flag: 'a' })
    return completed ?? task
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failed = updateTask(task.cwd, task.id, t => {
      t.status = 'failed'
      t.error = message
      t.completedAt = now()
    })
    writeFileSync(task.logFile, `[${now()}] worker failed: ${message}\n`, { flag: 'a' })
    return failed ?? task
  }
}

export function stopBackgroundTask(cwd: string, id: string): BackgroundTask | null {
  const task = getBackgroundTask(cwd, id)
  if (!task) return null
  const pid = task.agentPid ?? task.workerPid
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Process may have already exited; status update below is still useful.
    }
  }
  return updateTask(cwd, id, t => {
    t.status = 'canceled'
    t.completedAt = now()
  })
}

export function formatBackgroundTask(task: BackgroundTask): string {
  const lines = [
    `${task.id} [${task.status}] ${task.task}`,
    `cwd: ${task.cwd}`,
    `run: ${task.runCwd}`,
    `log: ${task.logFile}`,
    `output: ${task.outputFile}`,
    `inbox: ${task.inboxFile}`,
  ]
  if (task.workerPid) lines.push(`worker pid: ${task.workerPid}`)
  if (task.agentPid) lines.push(`agent pid: ${task.agentPid}`)
  if (task.worktree?.path) lines.push(`worktree: ${task.worktree.path}`)
  if (task.branch) lines.push(`branch: ${task.branch}`)
  if (task.pr?.enabled) {
    lines.push(`pr: ${task.pr.created ? 'created' : task.pr.error ? `failed (${task.pr.error})` : 'pending'}`)
    if (task.pr.command) lines.push(`pr command: ${task.pr.command.map(quote).join(' ')}`)
    if (task.pr.stdout?.trim()) lines.push(`pr stdout: ${task.pr.stdout.trim()}`)
  }
  if (task.error) lines.push(`error: ${task.error}`)
  return lines.join('\n')
}

export function formatBackgroundList(tasks: BackgroundTask[], json: boolean): string {
  if (json) return JSON.stringify({ tasks }, null, 2)
  if (tasks.length === 0) return 'No background agent runs yet.'
  return [
    'Background agent runs',
    '',
    ...tasks.map(t => {
      const pr = t.pr?.enabled ? ' pr' : ''
      const wt = t.worktree?.enabled ? ' worktree' : ''
      return `- ${t.id} [${t.status}]${wt}${pr} ${t.task}`
    }),
  ].join('\n')
}
