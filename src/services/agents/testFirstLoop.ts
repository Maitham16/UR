import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  detectProjectQualityStack,
  type ProjectQualityStack,
  type QualityCommand,
  type QualityPhase,
} from '../projectQuality.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import { splitCommand, summarizeFailure, type CommandResult } from './ciLoop.js'
import { getSessionId } from '../../bootstrap/state.js'
import {
  appendRunAction,
  appendRunTestsLog,
  initializeResearchTrace,
  writeRunDiff,
  writeRunReport,
} from './runArtifacts.js'

export type { QualityCommand, QualityPhase }
export type TestFirstStack = ProjectQualityStack
export const detectTestFirstStack = detectProjectQualityStack

export type TestFirstCommandRun = {
  attempt: number
  phase: QualityPhase
  command: string
  code: number
  passed: boolean
  durationMs: number
  tracePath?: string
  summary?: string
}

export type TestFirstAttempt = {
  attempt: number
  runs: TestFirstCommandRun[]
  fixVerdict?: string | null
  fixOutput?: string
  blockedByRunner?: boolean
}

export type TestFirstLoopResult = {
  status: 'passed' | 'planned' | 'exhausted' | 'blocked' | 'not-configured'
  stack: TestFirstStack
  attempts: TestFirstAttempt[]
  traceDir: string
  installedVerifyPath?: string
}

export type TestFirstCommandExec = (
  command: string,
  cwd: string,
) => Promise<CommandResult>

export type TestFirstLoopOptions = {
  cwd: string
  maxAttempts?: number
  dryRun?: boolean
  skipPermissions?: boolean
  maxTurns?: number
  installGates?: boolean
  traceDir?: string
  exec?: TestFirstCommandExec
  runner?: HeadlessRunner
  now?: () => Date
}

export type InstalledTestFirstGates = {
  path: string
  commands: string[]
}

function defaultTraceDir(cwd: string): string {
  return join(cwd, '.ur', 'test-first', 'traces')
}

const defaultExec: TestFirstCommandExec = async (command, cwd) => {
  const { file, args } = splitCommand(command)
  const result = await execFileNoThrowWithCwd(file, args, {
    cwd,
    timeout: 10 * 60 * 1000,
    preserveOutputOnError: true,
    maxBuffer: 2_000_000,
    audit: {
      cwd,
      reason: `run test-first quality command: ${command}`,
    },
  })
  return { code: result.code, stdout: result.stdout, stderr: result.stderr }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72) || 'command'
}

function writeFailureTrace(
  cwd: string,
  traceDir: string,
  run: Omit<TestFirstCommandRun, 'tracePath' | 'summary'>,
  result: CommandResult,
  now: Date,
): string {
  mkdirSync(traceDir, { recursive: true })
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const file = join(
    traceDir,
    `${stamp}-attempt-${run.attempt}-${run.phase}-${slug(run.command)}.log`,
  )
  const body = [
    '# UR test-first failure trace',
    '',
    `timestamp: ${now.toISOString()}`,
    `cwd: ${cwd}`,
    `attempt: ${run.attempt}`,
    `phase: ${run.phase}`,
    `command: ${run.command}`,
    `exitCode: ${run.code}`,
    '',
    '## stdout',
    result.stdout.trimEnd(),
    '',
    '## stderr',
    result.stderr.trimEnd(),
    '',
  ].join('\n')
  writeFileSync(file, body)
  return relative(cwd, file)
}

function readExistingVerifyConfig(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function mergeStringArray(existing: unknown, additions: string[]): string[] {
  const out = new Set<string>()
  if (Array.isArray(existing)) {
    for (const value of existing) if (typeof value === 'string') out.add(value)
  }
  for (const value of additions) out.add(value)
  return [...out]
}

export function installTestFirstGates(
  cwd: string,
  stack = detectTestFirstStack(cwd),
): InstalledTestFirstGates {
  const path = join(cwd, '.ur', 'verify.json')
  mkdirSync(dirname(path), { recursive: true })
  const commands = stack.commands.map(command => command.command)
  const existing = readExistingVerifyConfig(path)
  const next = {
    ...existing,
    afterEdit: mergeStringArray(existing.afterEdit, commands),
    timeoutMs:
      typeof existing.timeoutMs === 'number' && existing.timeoutMs > 0
        ? existing.timeoutMs
        : 600_000,
  }
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  return { path: relative(cwd, path), commands }
}

export async function runTestFirstLoop(
  options: TestFirstLoopOptions,
): Promise<TestFirstLoopResult> {
  const cwd = options.cwd
  const stack = detectTestFirstStack(cwd)
  const traceDir = options.traceDir ?? defaultTraceDir(cwd)
  const runId = getSessionId()
  initializeResearchTrace(cwd, runId, {
    kind: 'test-first',
    status: 'planned',
    goal: 'Detect stack, run compile/test/lint commands, and fix until green.',
    commands: stack.commands,
    missingPhases: stack.missingPhases,
  })
  appendRunAction(cwd, runId, {
    kind: 'test-first-plan',
    title: 'Detected test-first command plan',
    status: stack.commands.length > 0 ? 'planned' : 'skipped',
    data: {
      languages: stack.languages,
      packageManagers: stack.packageManagers,
      commands: stack.commands,
      missingPhases: stack.missingPhases,
    },
  })
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const exec = options.exec ?? defaultExec
  const runner =
    options.runner ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
  let installedVerifyPath: string | undefined

  const finish = (result: TestFirstLoopResult): TestFirstLoopResult => {
    writeRunReport(cwd, runId, formatTestFirstResult(result, false))
    return result
  }

  if (options.installGates) {
    installedVerifyPath = installTestFirstGates(cwd, stack).path
  }

  if (stack.commands.length === 0) {
    return finish({ status: 'not-configured', stack, attempts: [], traceDir })
  }

  if (options.dryRun) {
    return finish({ status: 'planned', stack, attempts: [], traceDir, installedVerifyPath })
  }

  const attempts: TestFirstAttempt[] = []
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const attempt: TestFirstAttempt = { attempt: attemptNumber, runs: [] }
    attempts.push(attempt)

    let failingRun: TestFirstCommandRun | null = null
    for (const qualityCommand of stack.commands) {
      const started = Date.now()
      const result = await exec(qualityCommand.command, cwd)
      const durationMs = Date.now() - started
      appendRunTestsLog(
        cwd,
        runId,
        [
          `# attempt ${attemptNumber} ${qualityCommand.phase}: ${qualityCommand.command}`,
          `exitCode: ${result.code}`,
          `durationMs: ${durationMs}`,
          '',
          '## stdout',
          result.stdout.trimEnd(),
          '',
          '## stderr',
          result.stderr.trimEnd(),
          '',
        ].join('\n'),
      )
      const baseRun = {
        attempt: attemptNumber,
        phase: qualityCommand.phase,
        command: qualityCommand.command,
        code: result.code,
        passed: result.code === 0,
        durationMs,
      }
      const run: TestFirstCommandRun =
        result.code === 0
          ? baseRun
          : {
              ...baseRun,
              summary: summarizeFailure(`${result.stdout}\n${result.stderr}`),
              tracePath: writeFailureTrace(
                cwd,
                traceDir,
                baseRun,
                result,
                options.now?.() ?? new Date(),
              ),
            }
      attempt.runs.push(run)
      appendRunAction(cwd, runId, {
        kind: 'test-first-command',
        title: `${qualityCommand.phase}: ${qualityCommand.command}`,
        status: run.passed ? 'passed' : 'failed',
        command: qualityCommand.command,
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        reason: `run detected ${qualityCommand.phase} command`,
        nextAction: run.passed
          ? 'continue to the next detected quality command'
          : 'capture failure trace and invoke fix agent if attempts remain',
        data: {
          attempt: attemptNumber,
          phase: qualityCommand.phase,
          durationMs,
          tracePath: run.tracePath,
          summary: run.summary,
        },
      })
      if (!run.passed) {
        failingRun = run
        break
      }
    }

    if (!failingRun) {
      await captureCurrentDiff(cwd, runId)
      return finish({ status: 'passed', stack, attempts, traceDir, installedVerifyPath })
    }

    if (attemptNumber === maxAttempts) break

    const fix = await runner({
      cwd,
      prompt: [
        'The test-first execution loop failed.',
        'Fix the repository so every detected compile, test, and lint command passes.',
        'Do not weaken tests, skip checks, or claim success without command evidence.',
        '',
        `Failed command: ${failingRun.command}`,
        `Phase: ${failingRun.phase}`,
        `Exit code: ${failingRun.code}`,
        failingRun.tracePath ? `Failure trace: ${failingRun.tracePath}` : null,
        '',
        'Failure summary:',
        failingRun.summary ?? '',
        '',
        'After editing, rerun the failing command and the full detected command set.',
        'End with VERDICT: PASS only if the commands actually exit 0.',
      ]
        .filter(Boolean)
        .join('\n'),
      maxTurns: options.maxTurns,
      skipPermissions: options.skipPermissions,
    })
    attempt.fixVerdict = fix.verdict ?? null
    attempt.fixOutput = String(fix.output ?? '').slice(-1000)
    appendRunAction(cwd, runId, {
      kind: 'test-first-fix-agent',
      title: `Fix attempt ${attemptNumber}`,
      status: fix.isError ? 'failed' : 'running',
      reason: 'invoke fix agent after failing quality command',
      nextAction: fix.isError ? 'stop because the fix runner failed' : 'rerun detected commands',
      data: {
        attempt: attemptNumber,
        verdict: fix.verdict ?? null,
        outputTail: attempt.fixOutput,
      },
    })
    if (fix.isError) {
      attempt.blockedByRunner = true
      await captureCurrentDiff(cwd, runId)
      return finish({ status: 'blocked', stack, attempts, traceDir, installedVerifyPath })
    }
  }

  await captureCurrentDiff(cwd, runId)
  return finish({ status: 'exhausted', stack, attempts, traceDir, installedVerifyPath })
}

async function captureCurrentDiff(cwd: string, runId: string): Promise<void> {
  const diff = await execFileNoThrowWithCwd('git', ['diff', '--no-ext-diff', '--'], {
    cwd,
    timeout: 30_000,
    preserveOutputOnError: true,
    audit: {
      cwd,
      runId,
      reason: 'capture research trace diff.patch',
    },
  })
  writeRunDiff(cwd, runId, diff.code === 0 ? diff.stdout : `${diff.stdout}\n${diff.stderr}`.trim())
}

export function formatTestFirstResult(
  result: TestFirstLoopResult,
  json: boolean,
): string {
  if (json) return JSON.stringify(result, null, 2)

  const lines = [
    `Test-first loop: ${result.status}`,
    `Stack: ${
      result.stack.languages.length ? result.stack.languages.join(', ') : 'unknown'
    } via ${
      result.stack.packageManagers.length
        ? result.stack.packageManagers.join(', ')
        : 'unknown package manager'
    }`,
    `Trace dir: ${relative(process.cwd(), result.traceDir) || '.'}`,
  ]
  if (result.installedVerifyPath) {
    lines.push(`Installed gates: ${result.installedVerifyPath}`)
  }
  lines.push('', 'Detected commands:')
  for (const command of result.stack.commands) {
    lines.push(`  ${command.phase}: ${command.command} (${command.source})`)
  }
  if (result.stack.missingPhases.length > 0) {
    lines.push(`Missing phases: ${result.stack.missingPhases.join(', ')}`)
  }

  if (result.status === 'planned') {
    lines.push('', 'Dry run only; no commands were executed.')
    return lines.join('\n')
  }
  if (result.status === 'not-configured') {
    lines.push('', 'No compile, test, or lint command was detected.')
    return lines.join('\n')
  }

  lines.push('', 'Command evidence:')
  for (const attempt of result.attempts) {
    for (const run of attempt.runs) {
      const tag = run.passed ? 'PASS' : `FAIL exit ${run.code}`
      lines.push(
        `  attempt ${run.attempt} ${run.phase}: ${tag} ${run.command} (${run.durationMs}ms)`,
      )
      if (run.tracePath) lines.push(`    trace: ${run.tracePath}`)
      if (run.summary && !run.passed) {
        lines.push(`    ${run.summary.split('\n').slice(-3).join(' / ').slice(0, 220)}`)
      }
    }
    if (attempt.fixVerdict || attempt.blockedByRunner) {
      lines.push(
        `  fix agent: ${attempt.blockedByRunner ? 'blocked' : attempt.fixVerdict ?? 'ran'}`,
      )
    }
  }
  return lines.join('\n')
}
