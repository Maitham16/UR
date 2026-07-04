import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import type {
  BackgroundTask,
  StartBackgroundTaskResult,
} from '../../services/agents/backgroundRunner.js'
import {
  decomposePrompt,
  renderTaskBoard,
  resolvePromptPlanningConfig,
  runPromptPlan,
  type NexusTask,
  type PromptPlan,
  type PromptPlanningConfig,
  type RunPromptPlanResult,
  type TaskApprovalDecision,
  type TaskExecutionEvent,
  type TaskExecutionResult,
  type TaskExecutor,
  type VerificationIssue,
} from '../../services/promptPlanning/index.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { gitExe } from '../../utils/git.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const flagsWithValue = new Set([
    '--concurrency',
    '--max-turns',
    '--max-agents',
    '--model',
    '--output-dir',
  ])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (flagsWithValue.has(token)) {
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
    '  ur exec "prompt" [--concurrency 1] [--max-turns 10] [--model qwen3-coder:480b-cloud] [--output-dir ./outputs]',
    '  echo \'{"prompt": "add tests"}\' | ur exec --concurrency 4',
    '  ur exec --file prompts.jsonl --concurrency 2',
    '  ur exec "update docs" --dry-run --max-agents 3',
    '  ur exec "single direct prompt" --no-task-planning',
    '  ur exec "quiet planned prompt" --quiet',
    '  ur exec "warn on unsupported claims" --no-strict-verification',
  ].join('\n')
}

type ExecPlanningOptions = Partial<PromptPlanningConfig>

export type ExecPoolResult = StartBackgroundTaskResult & {
  plan?: PromptPlan
  taskBoard?: string
  boardHistory?: string[]
  plannedRun?: RunPromptPlanResult
  finalReport?: ExecFinalReport
  finalReportText?: string
  commandsRun?: string[]
  changedFiles?: string[]
  verificationFailures?: ExecVerificationFailure[]
  warnings?: ExecVerificationFailure[]
}

export type ExecVerificationFailure = {
  taskId: string
  taskTitle: string
  code: string
  message: string
  severity: VerificationIssue['severity']
}

export type ExecFinalReport = {
  summary: {
    total: number
    finished: number
    failed: number
    waitingApproval: number
    skipped: number
  }
  activeAgentsUsed: number
  maxAgentsAllowed: number
  finishedTasks: Array<{ id: string; title: string; agent: string }>
  failedTasks: Array<{ id: string; title: string; agent: string }>
  waitingApprovalTasks: Array<{ id: string; title: string; agent: string }>
  skippedTasks: Array<{ id: string; title: string; agent: string }>
  actualChangedFiles: string[]
  unreportedChangedFiles: string[]
  outsideWorkspaceFilesAccessed: string[]
  outsideWorkspaceFilesModified: string[]
  verifiedCommands: string[]
  unverifiedCommandClaims: string[]
  approvalDecisions: TaskApprovalDecision[]
  filesChanged: string[]
  commandsRun: string[]
  verificationFailures: ExecVerificationFailure[]
  warnings: ExecVerificationFailure[]
  remainingLimitations: string[]
}

type RunExecPoolOptions = {
  cwd: string
  concurrency: number
  maxTurns?: number
  model?: string
  outputDir?: string
  worktree?: boolean
  dryRun?: boolean
  planning?: ExecPlanningOptions
  executePlannedTask?: TaskExecutor
  onPlanningEvent?: (event: TaskExecutionEvent) => void
  streamTaskBoard?: boolean
  writeTaskBoard?: (text: string) => void
  legacyRunner?: (prompts: string[], opts: RunExecPoolOptions) => Promise<ExecPoolResult[]>
}

export async function readPrompts(tokens: string[]): Promise<string[]> {
  const file = option(tokens, '--file')
  if (file) {
    const text = await Bun.file(file).text()
    return text
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          const parsed = JSON.parse(line) as { prompt?: string }
          return typeof parsed.prompt === 'string' ? parsed.prompt : line
        } catch {
          return line
        }
      })
  }
  const args = positionals(tokens)
  if (args.length > 0) return args

  if (!process.stdin.isTTY) {
    const text = await new Promise<string>(resolve => {
      let data = ''
      process.stdin.on('data', chunk => {
        data += chunk
      })
      process.stdin.on('end', () => resolve(data))
    })
    return text
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          const parsed = JSON.parse(line) as { prompt?: string }
          return typeof parsed.prompt === 'string' ? parsed.prompt : line
        } catch {
          return line
        }
      })
  }

  return []
}

export function execCommandForPrompt(
  prompt: string,
  opts: {
    maxTurns?: number
    model?: string
    worktree?: boolean
  },
): string[] {
  const args = ['-p', '--output-format', 'json']
  if (opts.maxTurns !== undefined) {
    args.push('--max-turns', String(opts.maxTurns))
  }
  if (opts.model) {
    args.push('--model', opts.model)
  }
  if (opts.worktree) {
    args.push('--worktree')
  }
  args.push(prompt)
  return [process.execPath, process.argv[1] ?? '', ...args]
}

function planPrompt(
  prompt: string,
  options?: ExecPlanningOptions,
): { plan?: PromptPlan; taskBoard?: string } {
  const config = resolvePromptPlanningConfig(options)
  if (!config.taskPlanning) return {}
  const plan = decomposePrompt(prompt, config)
  return {
    plan,
    taskBoard: config.showTaskBoard ? renderTaskBoard(plan) : undefined,
  }
}

function quoteCommandArg(arg: string): string {
  return /^[a-zA-Z0-9_./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg)
}

function formatCommand(args: string[]): string {
  return args.map(quoteCommandArg).join(' ')
}

function parseGitStatusFiles(output: string): string[] {
  const files: string[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const raw = line.slice(3).trim()
    if (!raw) continue
    const renamed = raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw
    if (renamed) files.push(renamed)
  }
  return [...new Set(files)]
}

async function currentChangedFiles(cwd: string): Promise<string[]> {
  const result = await execFileNoThrowWithCwd(gitExe(), ['status', '--porcelain'], {
    cwd,
    timeout: 30_000,
    preserveOutputOnError: true,
    audit: false,
  })
  return result.code === 0 ? parseGitStatusFiles(result.stdout) : []
}

export function changedFilesSinceBefore(
  beforeFiles: Iterable<string>,
  afterFiles: Iterable<string>,
): string[] {
  const before = new Set(beforeFiles)
  return [...afterFiles].filter(file => !before.has(file))
}

function plannedTaskPrompt(task: NexusTask): string {
  return [
    `UR-Nexus planned task ${task.id}: ${task.title}`,
    `Order: ${task.order}`,
    `Risk level: ${task.riskLevel}`,
    `Approval required: ${task.approvalRequired ? 'yes' : 'not required'}`,
    ...(task.approvalReason ? [`Approval reason: ${task.approvalReason}`] : []),
    '',
    task.description,
    '',
    `Assigned role: ${task.assignedAgent}`,
    `File targets: ${task.fileTargets.length > 0 ? task.fileTargets.join(', ') : 'not specified'}`,
    '',
    'Assumptions:',
    ...task.input.assumptions.map(value => `- ${value}`),
    '',
    `Expected output: ${task.expectedOutput}`,
    '',
    'Verification criteria:',
    ...task.verificationCriteria.map(value => `- ${value}`),
  ].join('\n')
}

function defaultPlannedTaskExecutor(opts: RunExecPoolOptions): TaskExecutor {
  return async task => {
    const command = execCommandForPrompt(plannedTaskPrompt(task), opts)
    const before = await currentChangedFiles(opts.cwd)
    const result = await execFileNoThrowWithCwd(command[0]!, command.slice(1), {
      cwd: opts.cwd,
      timeout: 10 * 60_000,
      preserveOutputOnError: true,
      maxBuffer: 10_000_000,
      audit: {
        cwd: opts.cwd,
        reason: `execute UR-Nexus planned task ${task.id}`,
        nextAction: 'verify task output against planning criteria',
      },
    })
    const after = await currentChangedFiles(opts.cwd)
    const changedFiles = changedFilesSinceBefore(before, after)
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
    return {
      ok: result.code === 0,
      output,
      changedFiles,
      commandsRun: [formatCommand(command)],
      error: result.code === 0 ? undefined : result.error ?? result.stderr,
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function writeTaskBoardUpdate(opts: RunExecPoolOptions, board: string): void {
  const writer = opts.writeTaskBoard ?? (text => process.stdout.write(text))
  writer(`${board}\n\n`)
}

function taskLine(task: NexusTask): { id: string; title: string; agent: string } {
  return {
    id: task.id,
    title: task.title,
    agent: String(task.assignedAgent),
  }
}

function isWaitingTask(task: NexusTask): boolean {
  return [
    'blocked',
    'waiting-approval',
    'needs-scope',
    'needs-context',
    'paused-review',
  ].includes(task.status)
}

export function buildExecFinalReport(run: RunPromptPlanResult): ExecFinalReport {
  const issues = run.taskResults.flatMap(record => {
    const issues = [
      ...record.preVerification.issues,
      ...(record.postVerification?.issues ?? []),
    ]
    return issues.map(issue => ({
      taskId: record.taskId,
      taskTitle: record.task.title,
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
    }))
  })
  const verificationFailures = issues.filter(issue => issue.severity === 'error')
  const warnings = issues.filter(issue => issue.severity === 'warning')
  const actualChangedFiles = unique(
    run.taskResults.flatMap(record => record.actualChangedFiles),
  )
  const verifiedCommands = unique(
    run.taskResults.flatMap(record => record.observedCommands),
  )
  return {
    summary: {
      total: run.tasks.length,
      finished: run.finished,
      failed: run.failed,
      waitingApproval: run.waitingApproval,
      skipped: run.skipped,
    },
    activeAgentsUsed: run.maxAgentsUsed,
    maxAgentsAllowed: run.maxAgentsAllowed,
    finishedTasks: run.tasks.filter(task => task.status === 'finished').map(taskLine),
    failedTasks: run.tasks.filter(task => task.status === 'failed').map(taskLine),
    waitingApprovalTasks: run.tasks.filter(isWaitingTask).map(taskLine),
    skippedTasks: run.tasks.filter(task => task.status === 'skipped').map(taskLine),
    actualChangedFiles,
    unreportedChangedFiles: unique(
      run.taskResults.flatMap(record => record.unreportedChangedFiles),
    ),
    outsideWorkspaceFilesAccessed: run.outsideWorkspaceReads,
    outsideWorkspaceFilesModified: run.outsideWorkspaceWrites,
    verifiedCommands,
    unverifiedCommandClaims: unique(
      run.taskResults.flatMap(record => record.unverifiedCommandClaims),
    ),
    approvalDecisions: run.approvalDecisions,
    filesChanged: actualChangedFiles,
    commandsRun: verifiedCommands,
    verificationFailures,
    warnings,
    remainingLimitations: [
      'File evidence is based on workspace snapshots before and after each task.',
      'Command evidence is confirmed only when the task runner surfaces observed commands.',
      'Detached or provider-internal tool activity is reported as unverified unless surfaced in task execution results.',
    ],
  }
}

function formatList<T>(
  items: T[],
  empty: string,
  render: (item: T) => string,
): string[] {
  return items.length > 0 ? items.map(render) : [`- ${empty}`]
}

function formatApprovalDecision(decision: TaskApprovalDecision): string {
  const details = [
    decision.command ? `command: ${decision.command}` : '',
    decision.paths.length > 0 ? `paths: ${decision.paths.join(', ')}` : '',
  ].filter(Boolean)
  return [
    `- ${decision.taskId} | ${decision.status} | ${decision.action}`,
    `  reason: ${decision.reason}`,
    ...(details.length > 0 ? [`  ${details.join(' | ')}`] : []),
  ].join('\n')
}

export function formatExecFinalReport(report: ExecFinalReport): string {
  return [
    'UR-Nexus task summary',
    `Total: ${report.summary.total}`,
    `Finished: ${report.summary.finished}`,
    `Failed: ${report.summary.failed}`,
    `Waiting approval/input: ${report.summary.waitingApproval}`,
    `Skipped: ${report.summary.skipped}`,
    `Agents used: ${report.activeAgentsUsed} active / ${report.maxAgentsAllowed} max`,
    '',
    'Finished tasks:',
    ...formatList(
      report.finishedTasks,
      'none',
      task => `- ${task.id} | ${task.agent} | ${task.title}`,
    ),
    '',
    'Failed tasks:',
    ...formatList(
      report.failedTasks,
      'none',
      task => `- ${task.id} | ${task.agent} | ${task.title}`,
    ),
    '',
    'Waiting approval/input tasks:',
    ...formatList(
      report.waitingApprovalTasks,
      'none',
      task => `- ${task.id} | ${task.agent} | ${task.title}`,
    ),
    '',
    'Skipped tasks:',
    ...formatList(
      report.skippedTasks,
      'none',
      task => `- ${task.id} | ${task.agent} | ${task.title}`,
    ),
    '',
    'Actual changed files:',
    ...formatList(
      report.actualChangedFiles,
      'none observed',
      file => `- ${file}`,
    ),
    '',
    'Outside-workspace files accessed:',
    ...formatList(
      report.outsideWorkspaceFilesAccessed,
      'none observed',
      file => `- ${file}`,
    ),
    '',
    'Outside-workspace files modified:',
    ...formatList(
      report.outsideWorkspaceFilesModified,
      'none observed',
      file => `- ${file}`,
    ),
    '',
    'Unreported changed files:',
    ...formatList(
      report.unreportedChangedFiles,
      'none',
      file => `- ${file}`,
    ),
    '',
    'Verified commands:',
    ...formatList(
      report.verifiedCommands,
      'none observed',
      command => `- ${command}`,
    ),
    '',
    'Unverified command claims:',
    ...formatList(
      report.unverifiedCommandClaims,
      'none',
      command => `- ${command}`,
    ),
    '',
    'Approval decisions:',
    ...formatList(
      report.approvalDecisions,
      'none',
      formatApprovalDecision,
    ),
    '',
    'Verification failures:',
    ...formatList(
      report.verificationFailures,
      'none',
      failure =>
        `- ${failure.taskId} | ${failure.code} | ${failure.message}`,
    ),
    '',
    'Warnings:',
    ...formatList(
      report.warnings,
      'none',
      warning => `- ${warning.taskId} | ${warning.code} | ${warning.message}`,
    ),
    '',
    'Remaining limitations:',
    ...report.remainingLimitations.map(item => `- ${item}`),
  ].join('\n')
}

function aggregateTask(
  prompt: string,
  plan: PromptPlan,
  run: RunPromptPlanResult,
  cwd: string,
): BackgroundTask {
  const failed =
    run.failed > 0 ||
    run.blocked > 0 ||
    run.waitingApproval > 0 ||
    run.skipped > 0
  const now = new Date().toISOString()
  return {
    id: plan.id,
    task: prompt,
    status: failed ? 'failed' : 'completed',
    cwd,
    runCwd: cwd,
    logFile: '',
    outputFile: '',
    inboxFile: '',
    createdAt: plan.createdAt,
    updatedAt: now,
    completedAt: now,
  }
}

async function runPromptPlans(
  prompts: string[],
  opts: RunExecPoolOptions,
): Promise<ExecPoolResult[]> {
  const config = resolvePromptPlanningConfig(opts.planning)
  const executeTask = opts.executePlannedTask ?? defaultPlannedTaskExecutor(opts)
  const results: ExecPoolResult[] = new Array(prompts.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, opts.concurrency), prompts.length) },
    async () => {
      for (;;) {
        const index = nextIndex
        nextIndex += 1
        if (index >= prompts.length) return
        const prompt = prompts[index]!
        const plan = decomposePrompt(prompt, config)
        const boardHistory: string[] = []
        const run = await runPromptPlan(plan, {
          cwd: opts.cwd,
          config,
          executeTask,
          onEvent: event => {
            if (event.type === 'board') {
              boardHistory.push(event.board)
              if (opts.streamTaskBoard) writeTaskBoardUpdate(opts, event.board)
            }
            opts.onPlanningEvent?.(event)
          },
        })
        const completedPlan = { ...plan, tasks: run.tasks }
        const taskBoard = config.showTaskBoard
          ? renderTaskBoard(completedPlan, { maxAgents: run.maxAgentsAllowed })
          : undefined
        const finalReport = buildExecFinalReport(run)
        const command = finalReport.commandsRun
        results[index] = {
          task: aggregateTask(prompt, completedPlan, run, opts.cwd),
          command,
          dryRun: false,
          plan: completedPlan,
          taskBoard,
          boardHistory,
          plannedRun: run,
          finalReport,
          finalReportText: formatExecFinalReport(finalReport),
          commandsRun: finalReport.commandsRun,
          changedFiles: finalReport.filesChanged,
          verificationFailures: finalReport.verificationFailures,
          warnings: finalReport.warnings,
        }
      }
    },
  )
  await Promise.all(workers)
  return results
}

export async function runExecPool(
  prompts: string[],
  opts: RunExecPoolOptions,
): Promise<ExecPoolResult[]> {
  const planning = resolvePromptPlanningConfig(opts.planning)
  if (opts.dryRun) {
    return prompts.map((prompt, index) => ({
      task: {
        id: `dry-run-${index}`,
        task: prompt,
        status: 'queued' as const,
        cwd: opts.cwd,
        runCwd: opts.cwd,
        logFile: '',
        outputFile: '',
        inboxFile: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      command: execCommandForPrompt(prompt, opts),
      dryRun: true,
      ...planPrompt(prompt, planning),
    }))
  }

  if (planning.taskPlanning) {
    return await runPromptPlans(prompts, { ...opts, planning })
  }

  if (opts.legacyRunner) {
    return await opts.legacyRunner(prompts, opts)
  }

  const {
    fanoutBackgroundTasks,
    startBackgroundTask,
  } = await import('../../services/agents/backgroundRunner.js')

  if (opts.concurrency === 1 && prompts.length === 1) {
    const command = execCommandForPrompt(prompts[0]!, opts)
    return [
      await startBackgroundTask({
        cwd: opts.cwd,
        task: prompts[0]!,
        worktree: opts.worktree,
        model: opts.model,
        maxTurns: opts.maxTurns,
        bin: { file: command[0]!, baseArgs: command.slice(1, -1) },
      }),
    ]
  }

  return await fanoutBackgroundTasks({
    cwd: opts.cwd,
    task: prompts[0]!,
    agents: Math.min(prompts.length, opts.concurrency),
    worktree: opts.worktree,
    model: opts.model,
    maxTurns: opts.maxTurns,
  })
}

function writeOutputFile(outputDir: string, prompt: string, content: string): void {
  mkdirSync(outputDir, { recursive: true })
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'task'
  writeFileSync(join(outputDir, `${slug}.txt`), content)
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const concurrency = Math.max(1, Math.min(32, Number(option(tokens, '--concurrency') ?? '1')))
  const maxTurns = option(tokens, '--max-turns') ? Number(option(tokens, '--max-turns')) : undefined
  const model = option(tokens, '--model')
  const outputDir = option(tokens, '--output-dir')
  const worktree = tokens.includes('--worktree')
  const dryRun = tokens.includes('--dry-run')
  const quiet = tokens.includes('--quiet')
  const planning = resolvePromptPlanningConfig({
    taskPlanning: !tokens.includes('--no-task-planning'),
    parallelAgents: !tokens.includes('--no-parallel-agents'),
    maxAgents: option(tokens, '--max-agents')
      ? Number(option(tokens, '--max-agents'))
      : undefined,
    showTaskBoard: !tokens.includes('--no-task-board'),
    strictVerification: !tokens.includes('--no-strict-verification'),
  })

  const prompts = await readPrompts(tokens)
  if (prompts.length === 0) {
    return { type: 'text', value: usage() }
  }

  const results = await runExecPool(prompts, {
    cwd: getCwd(),
    concurrency,
    maxTurns,
    model,
    outputDir,
    worktree,
    dryRun,
    planning,
    streamTaskBoard: planning.showTaskBoard && !json && !quiet && !dryRun,
  })
  const background = results.some(result => !result.dryRun)
    ? await import('../../services/agents/backgroundRunner.js')
    : null

  const outputs = results.map((result, index) => {
    const prompt = prompts[index] ?? prompts[0]!
    const task = result.dryRun
      ? undefined
      : background?.getBackgroundTask(getCwd(), result.task.id)
    const log = task ? background!.readBackgroundLog(getCwd(), result.task.id) : null
    const content = result.finalReportText ?? log ?? ''
    if (outputDir && !result.dryRun) {
      writeOutputFile(outputDir, prompt, content)
    }
    return {
      index,
      prompt,
      taskId: result.task.id,
      command: result.command,
      status: task?.status ?? result.task.status,
      output: content || undefined,
      plan: result.plan,
      taskBoard: result.taskBoard,
      boardHistory: result.boardHistory,
      finalReport: result.finalReport,
      commandsRun: result.commandsRun,
      changedFiles: result.changedFiles,
      verificationFailures: result.verificationFailures,
      warnings: result.warnings,
    }
  })

  return {
    type: 'text',
    value: json
      ? JSON.stringify(outputs, null, 2)
      : outputs
          .map(o =>
            [
              ...(o.taskBoard ? [o.taskBoard, ''] : []),
              ...(o.finalReport ? [formatExecFinalReport(o.finalReport), ''] : []),
              `${o.index}: ${o.prompt} -> ${o.status}`,
            ].join('\n'),
          )
          .join('\n'),
  }
}
