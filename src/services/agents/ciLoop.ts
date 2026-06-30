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
import { addRunArtifact } from './runArtifacts.js'
import { getSessionId } from '../../bootstrap/state.js'
import { type ExecTargetConfig, wrapCommand } from './execTarget.js'
import { recordFailure, recordResolution } from './failureMemory.js'

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
  const flagged = lines.filter(line =>
    /\b(error|fail(ed|ure)?|exception|expected|assert|✗|✖|×|cannot|not found|undefined)\b/i.test(line),
  )
  const picked = (flagged.length ? flagged : lines.filter(l => l.trim())).slice(-maxLines)
  return picked.join('\n').slice(-4000)
}

const defaultExec: CommandExec = async (file, args, cwd) => {
  const r = await execFileNoThrowWithCwd(file, args, {
    cwd,
    timeout: 10 * 60 * 1000,
    preserveOutputOnError: true,
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
  status: 'passed' | 'failed' | 'exhausted' | 'blocked' | 'cannot-fix'
  attempts: CiAttempt[]
  /** When the loop exhausts its budget, this records why the last fix could not resolve the failure. */
  cannotFixReason?: string
  /** Paths that were changed by the last fix and tripped a constitution warning. */
  constitutionWarnings?: string[]
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

export async function runCiLoop(options: CiLoopOptions): Promise<CiLoopResult> {
  const { cwd, command } = options
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
  let lastFailure:
    | { summary: string; attemptedFix?: string }
    | undefined

  if (options.dryRun) {
    return {
      command,
      status: 'failed',
      attempts: [
        { attempt: 1, code: -1, passed: false, summary: `[dry-run] would run "${command}" and fix up to ${maxAttempts} time(s).` },
      ],
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let summary: string
    if (attempt === 1 && options.seedError) {
      summary = summarizeFailure(options.seedError)
      attempts.push({ attempt, code: 1, passed: false, summary })
      recordFailure(cwd, {
        failedCommand: command,
        errorTrace: summary,
      })
      lastFailure = { summary }
      options.onEvent?.({ attempt, phase: 'run', detail: 'seeded from log' })
    } else {
      options.onEvent?.({ attempt, phase: 'run', detail: command })
      const run = await exec(file, args, cwd)
      if (run.code === 0) {
        attempts.push({ attempt, code: 0, passed: true })
        if (lastFailure) {
          recordResolution(
            cwd,
            command,
            `Command passed on attempt ${attempt} after ${attempt - 1} failed attempt(s).`,
          )
        }
        return { command, status: 'passed', attempts }
      }
      summary = summarizeFailure(`${run.stdout}\n${run.stderr}`)
      attempts.push({ attempt, code: run.code, passed: false, summary })
      recordFailure(cwd, {
        failedCommand: command,
        errorTrace: summary,
      })
      lastFailure = { summary }
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
    recordFailure(cwd, {
      failedCommand: command,
      errorTrace: summary,
      attemptedFix: lastFailure.attemptedFix,
    })

    // Constitution guard: detect deletion intent in the fix output.
    const requireApprovalForDeletion = options.requireApprovalForDeletion ?? true
    if (requireApprovalForDeletion) {
      const deletion = detectDeletionIntent(fix.output)
      if (deletion.detected) {
        last.blockedByConstitution = true
        last.constitutionNotes = [
          `Deletion intent detected in fix output and blocked: ${deletion.matches.join(', ')}`,
        ]
        return {
          command,
          status: 'blocked',
          attempts,
          cannotFixReason: 'Fix proposed deletion without explicit approval; blocked by agent constitution.',
          constitutionWarnings: deletion.matches,
        }
      }
    }

    // Constitution guard: detect changes to generated/vendor files after the fix.
    if (!allowGenerated) {
      const changedFiles = await listChangedFiles(git, cwd)
      const generatedChanged = changedFiles.filter(isGeneratedFile)
      if (generatedChanged.length > 0) {
        last.blockedByConstitution = true
        last.constitutionNotes = [
          `Generated/vendor files changed by fix and were reverted: ${generatedChanged.join(', ')}`,
        ]
        // Revert the generated files so the next attempt starts clean.
        await git('git', ['checkout', '--', ...generatedChanged], cwd)
      }
      const publicApiChanged = detectPublicApiChanges(changedFiles)
      if (publicApiChanged.length > 0) {
        last.constitutionNotes = [
          ...(last.constitutionNotes ?? []),
          `Public API surface changed by fix: ${publicApiChanged.join(', ')}`,
        ]
      }
    }

    if (options.commit || options.push) {
      const diff = await git('git', ['diff', 'HEAD'], cwd)
      if (hasBlockingFindings(reviewDiff(diff.stdout))) {
        last.blockedByReview = true
        return { command, status: 'blocked', attempts }
      }
      // Constitution guard: do not auto-commit changes to generated/vendor files unless explicitly allowed.
      if (!allowGenerated) {
        const changedFiles = await listChangedFiles(git, cwd)
        const generatedChanged = changedFiles.filter(isGeneratedFile)
        if (generatedChanged.length > 0) {
          last.blockedByReview = true
          return {
            command,
            status: 'blocked',
            attempts,
          }
        }
        const publicApiChanged = detectPublicApiChanges(changedFiles)
        if (publicApiChanged.length > 0) {
          last.blockedByReview = true
          return {
            command,
            status: 'blocked',
            attempts,
          }
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

  const runId = getSessionId()
  addRunArtifact(cwd, runId, {
    kind: 'ci-cannot-fix',
    path: 'ci-cannot-fix.md',
    title: `CI cannot fix: ${command}`,
  })

  return {
    command,
    status: 'cannot-fix',
    attempts,
    cannotFixReason,
    constitutionWarnings: finalAttempt?.constitutionNotes,
  }
}

async function listChangedFiles(git: CommandExec, cwd: string): Promise<string[]> {
  const status = await git('git', ['status', '--porcelain=v1'], cwd)
  if (status.code !== 0) return []
  return status.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      // Porcelain v1 format: XY path or XY path -> "original" for renames; take the new path.
      const m = line.match(/^\s*\S+\s+(?:.*?\s+->\s+)?(.+)$/)
      return m?.[1] ?? line.slice(3).trim()
    })
}

export function formatCiLoopResult(result: CiLoopResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `CI loop: ${result.command}`,
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
