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
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import { type ExecTargetConfig, wrapCommand } from './execTarget.js'

export type CommandResult = { code: number; stdout: string; stderr: string }
export type CommandExec = (file: string, args: string[], cwd: string) => Promise<CommandResult>

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
}

export type CiLoopResult = {
  command: string
  status: 'passed' | 'failed' | 'exhausted' | 'blocked'
  attempts: CiAttempt[]
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
      options.onEvent?.({ attempt, phase: 'run', detail: 'seeded from log' })
    } else {
      options.onEvent?.({ attempt, phase: 'run', detail: command })
      const run = await exec(file, args, cwd)
      if (run.code === 0) {
        attempts.push({ attempt, code: 0, passed: true })
        return { command, status: 'passed', attempts }
      }
      summary = summarizeFailure(`${run.stdout}\n${run.stderr}`)
      attempts.push({ attempt, code: run.code, passed: false, summary })
    }

    if (attempt === maxAttempts) break

    options.onEvent?.({ attempt, phase: 'fix', detail: 'invoking fix agent' })
    const fix = await runner({
      cwd,
      prompt: `The command \`${command}\` failed. Fix the code so it passes. Make the smallest change that addresses the root cause; do not weaken or skip tests.\n\nFailure output:\n${summary}\n\nEnd with VERDICT: PASS when you believe it is fixed.`,
      maxTurns: options.maxTurns,
      skipPermissions: options.skipPermissions,
    })
    const last = attempts[attempts.length - 1]
    last.fixVerdict = fix.verdict ?? null

    if (options.commit || options.push) {
      const diff = await git('git', ['diff', 'HEAD'], cwd)
      if (hasBlockingFindings(reviewDiff(diff.stdout))) {
        last.blockedByReview = true
        return { command, status: 'blocked', attempts }
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

  return { command, status: 'exhausted', attempts }
}

export function formatCiLoopResult(result: CiLoopResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `CI loop: ${result.command}`,
    `Status: ${result.status}`,
    '',
  ]
  for (const a of result.attempts) {
    const tag = a.passed ? 'PASS' : `exit ${a.code}`
    const extras = [
      a.fixVerdict ? `fix:${a.fixVerdict}` : null,
      a.committed ? 'committed' : null,
      a.pushed ? 'pushed' : null,
      a.blockedByReview ? 'blocked-by-review' : null,
    ]
      .filter(Boolean)
      .join(' ')
    lines.push(`  attempt ${a.attempt}: ${tag}${extras ? `  (${extras})` : ''}`)
    if (a.summary && !a.passed) {
      lines.push(`    ${a.summary.split('\n').slice(-3).join(' / ').slice(0, 200)}`)
    }
  }
  return lines.join('\n')
}
