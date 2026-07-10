/**
 * Self-healing CI loop.
 *
 * Runs a build/test command; on failure it extracts the salient error, hands it
 * to a headless fix agent, optionally commits, and re-runs — bounded by a retry
 * budget. This closes the loop that `autofix-pr` left open (Jules' headline:
 * CI fails -> fix -> re-push). Before any commit it runs UR's self-review gate
 * so a fix can never push secrets or conflict markers. The command splitter and
 * failure summarizer are pure; command execution and the agent are injectable so
 * the loop logic is unit-testable without running a real build.
 */

import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { hasBlockingFindings, reviewDiff } from '../../commands/agent-task/selfReview.js'
import { isGeneratedFile } from '../../utils/generatedFiles.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import {
  addRunArtifact,
  appendRunAction,
  appendRunTestsLog,
  initializeResearchTrace,
  writeRunDiff,
  writeRunReport,
} from './runArtifacts.js'
import { getSessionId } from '../../bootstrap/state.js'
import { type ExecTargetConfig, wrapCommand } from './execTarget.js'
import { recordFailure, recordResolution } from './failureMemory.js'
import { recordOutcome } from './learning.js'

export type CommandResult = { code: number; stdout: string; stderr: string }
export type CommandExec = (file: string, args: string[], cwd: string) => Promise<CommandResult>

/** Non-negotiable agent constitution injected into every fix prompt. */
export const AGENT_CONSTITUTION = `AGENT CONSTITUTION (hard rules — violation is a bug):
1. NEVER HIDE FAILURE. If a fix, test, or command fails, report the failure verbatim; do not silently skip, rename, or misrepresent it.
2. NEVER DELETE code, files, tests, or data without explicit user approval in the prompt. Removing generated artifacts (dist, node_modules) is allowed only when that is the stated task.
3. NEVER EDIT GENERATED OR VENDOR FILES unless explicitly asked. Skip lockfiles, dist/, node_modules/, vendored/, third_party/, .d.ts, *.min.*, *.generated.*, and similar.
4. NEVER CLAIM TESTS PASSED unless you actually executed the command and observed exit code 0. A verdict alone is not proof; attach command evidence.
5. NEVER CHANGE PUBLIC API (exported names, function signatures, CLI flags, env vars) without an explicit warning and, when possible, backwards compatibility. Prefer additive changes.`

export function buildFixPrompt(command: string, summary: string, allowGenerated = false): string {
  const generatedNote = allowGenerated
    ? ''
    : '\nSkip generated/vendor files; do not edit lockfiles, dist/, node_modules/, vendored code, .d.ts, *.min.*, or *.generated.* unless explicitly asked.'
  return `${AGENT_CONSTITUTION}\n\nThe command \`${command}\` failed. Fix the code so it passes. Make the smallest change that addresses the root cause; do not weaken or skip tests.${generatedNote}\n\nFailure output:\n${summary}\n\nEnd with VERDICT: PASS only if you actually ran the failing command and saw exit code 0. Include command evidence in your output.`
}

export function detectPublicApiChanges(filePaths: string[]): string[] {
  return filePaths.filter(path => {
    if (isGeneratedFile(path)) return false
    const parts = path.split('/')
    const name = parts[parts.length - 1] ?? ''
    const base = name.replace(/\.(ts|js|tsx|jsx|mjs|cjs)$/, '')
    // Heuristic: index files and files named after exported concepts are likely public API surfaces.
    return name === 'index.ts' || name === 'index.js' || base === 'public' || base === 'api' || base.endsWith('Api')
  })
}

/** Detect deletion commands or statements in agent output that would violate the constitution. */
export function detectDeletionIntent(output: string): { detected: boolean; matches: string[] } {
  const patterns = [
    /\brm\s+(?:-[rf]+\s+)?\S+/i,
    /\brmdir\b/i,
    /\brimraf\b/i,
    /\bfs\.unlink\b/i,
    /\bfs\.rmdir\b/i,
    /\bfs\.rm\b/i,
    /\bgit\s+rm\b/i,
    /\bdelete\s+(?:file|folder|directory|test)\b/i,
  ]
  const matches: string[] = []
  for (const pattern of patterns) {
    const found = output.match(pattern)
    if (found) matches.push(found[0])
  }
  return { detected: matches.length > 0, matches }
}

export function splitCommand(command: string): { file: string; args: string[] } {
  const parts = command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  const cleaned = parts.map(p => p.replace(/^["']|["']$/g, ''))
  return { file: cleaned[0] ?? '', args: cleaned.slice(1) }
}

/** Pull the most useful slice out of a noisy build log for the fix prompt. */
export function summarizeFailure(output: string, maxLines = 40): string {
  const lines = output.split('\n')
  const failurePattern =
    /\b(error|fail(ed|ure)?|exception|expected|assert|✗|✖|×|cannot|not found|undefined)\b/i
  const passingTestPattern = /^\s*(?:\(pass\)|✓|✔|PASS\b)/i
  const failureIndexes = lines.flatMap((line, index) =>
    failurePattern.test(line) && !passingTestPattern.test(line) ? [index] : [],
  )

  const contextIndexes = new Set<number>()
  for (const index of failureIndexes) {
    for (
      let contextIndex = Math.max(0, index - 2);
      contextIndex <= Math.min(lines.length - 1, index + 5);
      contextIndex++
    ) {
      contextIndexes.add(contextIndex)
    }
  }

  const contextual = [...contextIndexes]
    .sort((left, right) => left - right)
    .map(index => lines[index]!)
    .filter(line => line.trim() && !passingTestPattern.test(line))
  const picked = (contextual.length ? contextual : lines.filter(l => l.trim())).slice(
    -maxLines,
  )
  return picked.join('\n').slice(-4000)
}

const defaultExec: CommandExec = async (file, args, cwd) => {
  const r = await execFileNoThrowWithCwd(file, args, {
    cwd,
    timeout: 10 * 60 * 1000,
    preserveOutputOnError: true,
    audit: {
      cwd,
      reason: `run CI loop command: ${[file, ...args].join(' ')}`,
    },
  })
  return { code: r.code, stdout: r.stdout, stderr: r.stderr }
}

export type CiAttempt = {
  attempt: number
  code: number
  passed: boolean
  summary?: string
  fixVerdict?: string | null
  committed?: boolean
  pushed?: boolean
  blockedByReview?: boolean
  blockedByConstitution?: boolean
  constitutionNotes?: string[]
}

export type CiLoopResult = {
  command: string
  /** Absolute directory in which the CI command actually ran. */
  cwd?: string
  status: 'passed' | 'failed' | 'exhausted' | 'blocked' | 'cannot-fix'
  attempts: CiAttempt[]
  /** When the loop exhausts its budget, this records why the last fix could not resolve the failure. */
  cannotFixReason?: string
  /** Paths that were changed by the last fix and tripped a constitution warning. */
  constitutionWarnings?: string[]
}

export type GitStatusChange = {
  status: string
  path: string
  deleted: boolean
}

export type CiLoopOptions = {
  cwd: string
  command: string
  maxAttempts?: number
  commit?: boolean
  push?: boolean
  dryRun?: boolean
  skipPermissions?: boolean
  maxTurns?: number
  seedError?: string
  exec?: CommandExec
  runner?: HeadlessRunner
  git?: CommandExec
  /** When containerized, the build/test command runs in this target (git stays on host). */
  execTarget?: ExecTargetConfig
  onEvent?: (event: { attempt: number; phase: 'run' | 'fix' | 'commit'; detail: string }) => void
  /** Allow the fix agent to edit generated/vendor files. Default false. */
  allowGenerated?: boolean
  /** Require explicit confirmation before the fix agent deletes files. Default true. */
  requireApprovalForDeletion?: boolean
}

export function parseGitStatusChanges(output: string): GitStatusChange[] {
  return output
    .split('\n')
    .map(line => {
      if (!line.trim() || line.length < 4) return null
      const status = line.slice(0, 2)
      const rawPath = line.slice(3).trim()
      const path = rawPath.includes(' -> ')
        ? rawPath.split(' -> ').pop()!.trim()
        : rawPath
      return {
        status,
        path,
        deleted: status.includes('D'),
      }
    })
    .filter((change): change is GitStatusChange => Boolean(change?.path))
}

export function explainNonFixableCiFailure(
  command: string,
  output: string,
  cwd: string,
): string | undefined {
  if (!/\bno tests found!?\b/i.test(output)) return undefined
  return `No tests were discovered while running "${command}" in "${cwd}". Run /ci-loop from the project or test root, or pass --cwd <path>. No fix agent was started.`
}

export async function runCiLoop(options: CiLoopOptions): Promise<CiLoopResult> {
  const { cwd, command } = options
  const runId = getSessionId()
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const exec = options.exec ?? defaultExec
  const git = options.git ?? defaultExec
  const runner =
    options.runner ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
  const parsed = splitCommand(command)
  const { file, args } = options.execTarget
    ? wrapCommand(options.execTarget, parsed, cwd)
    : parsed
  const attempts: CiAttempt[] = []
  const constitutionWarnings = new Set<string>()
  let lastFailure:
    | { summary: string; attemptedFix?: string }
    | undefined

  const addConstitutionWarning = (warning: string) => {
    constitutionWarnings.add(warning)
  }

  const withConstitutionWarnings = (result: CiLoopResult): CiLoopResult => {
    const warnings = [
      ...(result.constitutionWarnings ?? []),
      ...[...constitutionWarnings].filter(warning => !(result.constitutionWarnings ?? []).includes(warning)),
    ]
    return warnings.length > 0 ? { ...result, constitutionWarnings: warnings } : result
  }

  initializeResearchTrace(cwd, runId, {
    kind: 'ci-loop',
    status: 'planned',
    goal: 'Run a build/test command, fix failures, and rerun until green or exhausted.',
    command,
    maxAttempts,
    commit: options.commit ?? false,
    push: options.push ?? false,
    dryRun: options.dryRun ?? false,
  })
  appendRunAction(cwd, runId, {
    kind: 'ci-loop-plan',
    title: command,
    status: options.dryRun ? 'skipped' : 'planned',
    command,
    reason: 'start self-healing CI loop',
    nextAction: options.dryRun ? 'report dry-run plan' : 'execute command and capture evidence',
    data: {
      maxAttempts,
      commit: options.commit ?? false,
      push: options.push ?? false,
      execTarget: options.execTarget,
    },
  })

  const finish = async (result: CiLoopResult): Promise<CiLoopResult> => {
    const finalized = { ...result, cwd }
    await captureCurrentDiff(cwd, runId)
    writeRunReport(cwd, runId, formatCiLoopResult(finalized, false))
    // Automatic learning: every real run teaches the router/escalator how
    // reliable this category of work is. Dry runs are excluded — their
    // synthetic 'failed' status would poison the stats.
    if (!options.dryRun) {
      recordOutcome(cwd, {
        id: `ci-${runId}`,
        task: command,
        model: null,
        pass: finalized.status === 'passed',
        detail: `ci-loop ${finalized.status}: ${command}`,
      })
    }
    return finalized
  }

  if (options.dryRun) {
    return finish({
      command,
      status: 'failed',
      attempts: [
        { attempt: 1, code: -1, passed: false, summary: `[dry-run] would run "${command}" and fix up to ${maxAttempts} time(s).` },
      ],
    })
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let summary: string
    let rawFailure: string
    if (attempt === 1 && options.seedError) {
      rawFailure = options.seedError
      summary = summarizeFailure(rawFailure)
      attempts.push({ attempt, code: 1, passed: false, summary })
      appendRunAction(cwd, runId, {
        kind: 'ci-loop-seeded-failure',
        title: `attempt ${attempt}: seeded failure`,
        status: 'failed',
        command,
        exitCode: 1,
        stderr: options.seedError,
        reason: 'seed CI loop from existing failure log',
        nextAction: 'invoke fix agent if attempts remain',
        data: { attempt, summary },
      })
      recordFailure(cwd, {
        failedCommand: command,
        errorTrace: summary,
      })
      lastFailure = { summary }
      options.onEvent?.({ attempt, phase: 'run', detail: 'seeded from log' })
    } else {
      options.onEvent?.({ attempt, phase: 'run', detail: command })
      const run = await exec(file, args, cwd)
      appendRunTestsLog(
        cwd,
        runId,
        [
          `# CI attempt ${attempt}: ${command}`,
          `exitCode: ${run.code}`,
          '',
          '## stdout',
          run.stdout.trimEnd(),
          '',
          '## stderr',
          run.stderr.trimEnd(),
          '',
        ].join('\n'),
      )
      appendRunAction(cwd, runId, {
        kind: 'ci-loop-command',
        title: `attempt ${attempt}: ${command}`,
        status: run.code === 0 ? 'passed' : 'failed',
        command,
        exitCode: run.code,
        stdout: run.stdout,
        stderr: run.stderr,
        reason: 'run CI/build/test command',
        nextAction: run.code === 0
          ? 'record success and finish'
          : 'summarize failure and invoke fix agent if attempts remain',
        data: { attempt },
      })
      if (run.code === 0) {
        attempts.push({ attempt, code: 0, passed: true })
        if (lastFailure) {
          recordResolution(
            cwd,
            command,
            `Command passed on attempt ${attempt} after ${attempt - 1} failed attempt(s).`,
          )
        }
        return finish(withConstitutionWarnings({ command, status: 'passed', attempts }))
      }
      rawFailure = `${run.stdout}\n${run.stderr}`
      summary = summarizeFailure(rawFailure)
      attempts.push({ attempt, code: run.code, passed: false, summary })
      recordFailure(cwd, {
        failedCommand: command,
        errorTrace: summary,
      })
      lastFailure = { summary }
    }

    const nonFixableReason = explainNonFixableCiFailure(
      command,
      rawFailure,
      cwd,
    )
    if (nonFixableReason) {
      addRunArtifact(cwd, runId, {
        kind: 'ci-cannot-fix',
        path: 'ci-cannot-fix.md',
        title: `CI cannot fix: ${command}`,
      })
      return finish({
        command,
        status: 'cannot-fix',
        attempts,
        cannotFixReason: nonFixableReason,
      })
    }

    if (attempt === maxAttempts) break

    options.onEvent?.({ attempt, phase: 'fix', detail: 'invoking fix agent' })
    const allowGenerated = options.allowGenerated ?? false
    const prompt = buildFixPrompt(command, summary, allowGenerated)
    const fix = await runner({
      cwd,
      prompt,
      maxTurns: options.maxTurns,
      skipPermissions: options.skipPermissions,
    })
    const last = attempts[attempts.length - 1]
    last.fixVerdict = fix.verdict ?? null
    lastFailure = {
      summary,
      attemptedFix: fix.output.slice(0, 2000),
    }
    appendRunAction(cwd, runId, {
      kind: 'ci-loop-fix-agent',
      title: `fix attempt ${attempt}`,
      status: fix.verdict === 'PASS' ? 'passed' : fix.isError ? 'failed' : 'running',
      reason: 'invoke fix agent after CI failure',
      nextAction: fix.isError ? 'stop because fix agent failed' : 'rerun CI command',
      data: {
        attempt,
        verdict: fix.verdict ?? null,
        outputTail: fix.output.slice(-1200),
      },
    })
    recordFailure(cwd, {
      failedCommand: command,
      errorTrace: summary,
      attemptedFix: lastFailure.attemptedFix,
    })

    if (fix.isError) {
      const fixSummary = summarizeFailure(fix.output, 20) || fix.output.slice(-1000)
      return finish(withConstitutionWarnings({
        command,
        status: 'cannot-fix',
        attempts,
        cannotFixReason: `Fix agent failed after CI attempt ${attempt}: ${fixSummary}`,
      }))
    }

    const changedFileDetails = await listChangedFileDetails(git, cwd)

    // Constitution guard: detect deletion intent in the fix output.
    const requireApprovalForDeletion = options.requireApprovalForDeletion ?? true
    if (requireApprovalForDeletion) {
      const deletion = detectDeletionIntent(fix.output)
      const deletedFiles = changedFileDetails
        .filter(change => change.deleted)
        .map(change => change.path)
      if (deletion.detected) {
        last.blockedByConstitution = true
        last.constitutionNotes = [
          `Deletion intent detected in fix output and blocked: ${deletion.matches.join(', ')}`,
        ]
        return finish({
          command,
          status: 'blocked',
          attempts,
          cannotFixReason: 'Fix proposed deletion without explicit approval; blocked by agent constitution.',
          constitutionWarnings: deletion.matches,
        })
      }
      if (deletedFiles.length > 0) {
        last.blockedByConstitution = true
        last.constitutionNotes = [
          ...(last.constitutionNotes ?? []),
          `Deleted files detected in git status and blocked: ${deletedFiles.join(', ')}`,
        ]
        return finish(withConstitutionWarnings({
          command,
          status: 'blocked',
          attempts,
          cannotFixReason: 'Fix deleted files without explicit approval; blocked by agent constitution.',
          constitutionWarnings: deletedFiles,
        }))
      }
    }

    // Constitution guard: detect changes to generated/vendor files after the fix.
    if (!allowGenerated) {
      const changedFiles = changedFileDetails.map(change => change.path)
      const generatedChanged = changedFiles.filter(isGeneratedFile)
      if (generatedChanged.length > 0) {
        last.blockedByConstitution = true
        last.constitutionNotes = [
          `Generated/vendor files changed by fix and were blocked: ${generatedChanged.join(', ')}`,
        ]
        // Restore generated/vendor files so the blocked run does not leave those edits behind.
        const restore = await git('git', ['checkout', '--', ...generatedChanged], cwd)
        const restoreNote = restore.code === 0
          ? `Generated/vendor files were restored after violation: ${generatedChanged.join(', ')}`
          : `Generated/vendor files changed and automatic restore failed: ${generatedChanged.join(', ')}`
        addConstitutionWarning(restoreNote)
        return finish(withConstitutionWarnings({
          command,
          status: 'blocked',
          attempts,
          cannotFixReason: 'Fix edited generated/vendor files without --allow-generated; blocked by agent constitution.',
          constitutionWarnings: generatedChanged,
        }))
      }
      const publicApiChanged = detectPublicApiChanges(changedFiles)
      if (publicApiChanged.length > 0) {
        const warning = `Public API surface changed by fix; review compatibility before merging: ${publicApiChanged.join(', ')}`
        addConstitutionWarning(warning)
        last.constitutionNotes = [
          ...(last.constitutionNotes ?? []),
          warning,
        ]
      }
    }

    if (options.commit || options.push) {
      const diff = await git('git', ['diff', 'HEAD'], cwd)
      if (hasBlockingFindings(reviewDiff(diff.stdout))) {
        last.blockedByReview = true
        return finish({ command, status: 'blocked', attempts })
      }
      // Constitution guard: do not auto-commit changes to generated/vendor files unless explicitly allowed.
      if (!allowGenerated) {
        const changedFiles = await listChangedFiles(git, cwd)
        const generatedChanged = changedFiles.filter(isGeneratedFile)
        if (generatedChanged.length > 0) {
          last.blockedByReview = true
          return finish({
            command,
            status: 'blocked',
            attempts,
          })
        }
        const publicApiChanged = detectPublicApiChanges(changedFiles)
        if (publicApiChanged.length > 0) {
          last.blockedByReview = true
          addConstitutionWarning(
            `Public API surface changed by fix; commit/push blocked until reviewed: ${publicApiChanged.join(', ')}`,
          )
          return finish(withConstitutionWarnings({
            command,
            status: 'blocked',
            attempts,
          }))
        }
      }
      await git('git', ['add', '-A'], cwd)
      const committed = await git('git', ['commit', '-m', `ur: self-healing CI fix (attempt ${attempt})`], cwd)
      last.committed = committed.code === 0
      options.onEvent?.({ attempt, phase: 'commit', detail: last.committed ? 'committed' : 'nothing to commit' })
      if (options.push && last.committed) {
        const pushed = await git('git', ['push'], cwd)
        last.pushed = pushed.code === 0
      }
    }
  }

  // The loop exhausted its retry budget. Record a "cannot fix" artifact.
  const finalAttempt = attempts[attempts.length - 1]
  const cannotFixReason = finalAttempt?.constitutionNotes
    ? `Constitution violations prevented fixes: ${finalAttempt.constitutionNotes.join('; ')}`
    : `The command "${command}" still failed after ${maxAttempts} attempts. The fix agent could not make it pass.`

  addRunArtifact(cwd, runId, {
    kind: 'ci-cannot-fix',
    path: 'ci-cannot-fix.md',
    title: `CI cannot fix: ${command}`,
  })

  return finish(withConstitutionWarnings({
    command,
    status: 'cannot-fix',
    attempts,
    cannotFixReason,
    constitutionWarnings: finalAttempt?.constitutionNotes,
  }))
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

async function listChangedFiles(git: CommandExec, cwd: string): Promise<string[]> {
  return (await listChangedFileDetails(git, cwd)).map(change => change.path)
}

async function listChangedFileDetails(git: CommandExec, cwd: string): Promise<GitStatusChange[]> {
  const status = await git('git', ['status', '--porcelain=v1'], cwd)
  if (status.code !== 0) return []
  return parseGitStatusChanges(status.stdout)
}

export function formatCiLoopResult(result: CiLoopResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `CI loop: ${result.command}`,
    ...(result.cwd ? [`Working directory: ${result.cwd}`] : []),
    `Status: ${result.status}`,
  ]
  if (result.cannotFixReason) {
    lines.push(`Reason: ${result.cannotFixReason}`)
  }
  if (result.constitutionWarnings && result.constitutionWarnings.length > 0) {
    lines.push(`Constitution warnings: ${result.constitutionWarnings.join(', ')}`)
  }
  lines.push('')
  for (const a of result.attempts) {
    const tag = a.passed ? 'PASS' : `exit ${a.code}`
    const extras = [
      a.fixVerdict ? `fix:${a.fixVerdict}` : null,
      a.committed ? 'committed' : null,
      a.pushed ? 'pushed' : null,
      a.blockedByReview ? 'blocked-by-review' : null,
      a.blockedByConstitution ? 'blocked-by-constitution' : null,
    ]
      .filter(Boolean)
      .join(' ')
    lines.push(`  attempt ${a.attempt}: ${tag}${extras ? `  (${extras})` : ''}`)
    if (a.summary && !a.passed) {
      lines.push(`    ${a.summary.split('\n').slice(-3).join(' / ').slice(0, 200)}`)
    }
    if (a.constitutionNotes) {
      for (const note of a.constitutionNotes) {
        lines.push(`    ⚠ ${note.slice(0, 200)}`)
      }
    }
  }
  return lines.join('\n')
}
