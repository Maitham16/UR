/**
 * Multi-agent best-of-N (the "arena").
 *
 * Runs N independent agents on the *same* task, each in its own git worktree so
 * their edits never collide, then judges the resulting diffs and surfaces the
 * winner — optionally applying it back to the main tree. The judge reuses UR's
 * deterministic self-review gate (blocking findings sink a candidate) plus the
 * agent verdict and diff shape, so scoring is explainable and unit-testable
 * offline. This is UR's local-first take on Cursor's parallel-agent judging.
 */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { reviewDiff, type ReviewFinding } from '../../commands/agent-task/selfReview.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import { recordOutcome } from './learning.js'

export type Candidate = {
  id: string
  model?: string
  worktree?: string
  branch?: string
  diff: string
  output: string
  verdict: string | null
  isError: boolean
}

export type ScoredCandidate = Candidate & {
  score: number
  changedLines: number
  blocking: number
  warnings: number
  reasons: string[]
}

function countChangedLines(diff: string): number {
  let count = 0
  for (const line of diff.split('\n')) {
    if ((line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
      count++
    }
  }
  return count
}

/** Pure deterministic judge for one candidate. Higher is better. */
export function scoreCandidate(candidate: Candidate): ScoredCandidate {
  const findings: ReviewFinding[] = reviewDiff(candidate.diff)
  const blocking = findings.filter(f => f.severity === 'block').length
  const warnings = findings.filter(f => f.severity === 'warn').length
  const changedLines = countChangedLines(candidate.diff)
  const reasons: string[] = []

  let score = 0
  if (candidate.isError) {
    score -= 10
    reasons.push('run errored')
  }
  if (candidate.verdict === 'PASS') {
    score += 5
    reasons.push('verdict PASS')
  } else if (candidate.verdict === 'PARTIAL') {
    score += 1
    reasons.push('verdict PARTIAL')
  } else if (candidate.verdict === 'FAIL') {
    score -= 5
    reasons.push('verdict FAIL')
  }
  if (changedLines === 0) {
    score -= 6
    reasons.push('empty diff (no change)')
  } else {
    score += 2
    reasons.push(`${changedLines} changed lines`)
  }
  if (blocking > 0) {
    score -= 8 * Math.min(blocking, 3)
    reasons.push(`${blocking} blocking finding(s)`)
  }
  if (warnings > 0) {
    score -= warnings
    reasons.push(`${warnings} warning(s)`)
  }
  // Tie-break: gently prefer the most focused diff among otherwise-equal runs.
  score -= changedLines * 0.001

  return {
    ...candidate,
    score: Number(score.toFixed(3)),
    changedLines,
    blocking,
    warnings,
    reasons,
  }
}

export type Judgement = {
  ranked: ScoredCandidate[]
  winner: ScoredCandidate | null
}

export function judge(candidates: Candidate[]): Judgement {
  const ranked = candidates.map(scoreCandidate).sort((a, b) => b.score - a.score)
  const winner = ranked.find(
    c => !c.isError && c.verdict === 'PASS' && c.changedLines > 0 && c.blocking === 0,
  ) ?? null
  return { ranked, winner }
}

export type RunArenaOptions = {
  cwd: string
  agents?: number
  models?: (string | undefined)[]
  dryRun?: boolean
  apply?: boolean
  keep?: boolean
  maxTurns?: number
  skipPermissions?: boolean
  runner?: HeadlessRunner
  onEvent?: (event: ArenaEvent) => void
}

export type ArenaEvent =
  | { kind: 'start'; id: string; model?: string }
  | { kind: 'done'; id: string; verdict: string | null; isError: boolean }
  | { kind: 'applied'; id: string }

export type ArenaResult = {
  task: string
  agents: number
  candidates: ScoredCandidate[]
  winner: ScoredCandidate | null
  applied: boolean
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return execFileNoThrowWithCwd('git', args, {
    cwd,
    timeout: 60_000,
    preserveOutputOnError: true,
  })
}

async function ensureWorktree(cwd: string, runId: string, id: string): Promise<{ path: string; branch: string } | null> {
  const root = join(cwd, '.ur', 'arena', '.worktrees')
  const path = join(root, `${runId}-${id}`)
  const branch = `ur/arena/${runId}/${id}`
  if (existsSync(path)) return null
  mkdirSync(root, { recursive: true })
  const result = await git(cwd, ['worktree', 'add', '-b', branch, path])
  return result.code === 0 ? { path, branch } : null
}

async function captureDiff(worktree: string): Promise<string> {
  await git(worktree, ['add', '-A'])
  const diff = await git(worktree, ['diff', '--cached'])
  return diff.code === 0 ? diff.stdout : ''
}

async function removeWorktree(cwd: string, worktree: string, branch: string): Promise<void> {
  await git(cwd, ['worktree', 'remove', '--force', worktree])
  await git(cwd, ['branch', '-D', branch])
  await git(cwd, ['worktree', 'prune'])
}

export async function runArena(task: string, options: RunArenaOptions): Promise<ArenaResult> {
  const cwd = options.cwd
  const requestedAgents = options.agents ?? 3
  if (!Number.isInteger(requestedAgents) || requestedAgents < 2 || requestedAgents > 8) {
    throw new Error('Arena agents must be an integer between 2 and 8.')
  }
  const agents = requestedAgents
  const runner =
    options.runner ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const prompt = `${task}\n\nImplement this fully and correctly. Make focused changes. End your reply with VERDICT: PASS or VERDICT: FAIL.`

  const ids = Array.from({ length: agents }, (_, i) => `c${i + 1}`)
  const candidates = await Promise.all(
    ids.map(async (id, index): Promise<Candidate> => {
      const model = options.models?.[index]
      options.onEvent?.({ kind: 'start', id, model })
      let worktree: string | undefined
      let branch: string | undefined
      let workCwd = cwd
      if (!options.dryRun && !options.runner) {
        const wt = await ensureWorktree(cwd, runId, id)
        if (!wt) {
          const output = `Failed to create an isolated worktree for ${id}; candidate was not run.`
          options.onEvent?.({ kind: 'done', id, verdict: 'FAIL', isError: true })
          return { id, model, diff: '', output, verdict: 'FAIL', isError: true }
        }
        worktree = wt.path
        branch = wt.branch
        workCwd = wt.path
      }
      let out: Awaited<ReturnType<HeadlessRunner>>
      try {
        out = await runner({
          cwd: workCwd,
          prompt,
          model,
          maxTurns: options.maxTurns,
          skipPermissions: options.skipPermissions,
        })
      } catch (error) {
        out = {
          output: error instanceof Error ? error.message : String(error),
          verdict: 'FAIL',
          isError: true,
        }
      }
      const diff =
        worktree && !options.dryRun ? await captureDiff(worktree) : ''
      options.onEvent?.({ kind: 'done', id, verdict: out.verdict ?? null, isError: !!out.isError })
      return {
        id,
        model,
        worktree,
        branch,
        diff,
        output: out.output,
        verdict: out.verdict ?? null,
        isError: !!out.isError,
      }
    }),
  )

  const { ranked, winner } = judge(candidates)

  let applied = false
  if (options.apply && winner && winner.diff.trim() && !options.dryRun) {
    const patch = join(cwd, '.ur', 'arena', `${runId}-winner.patch`)
    mkdirSync(join(cwd, '.ur', 'arena'), { recursive: true })
    writeFileSync(patch, winner.diff)
    const result = await git(cwd, ['apply', '--3way', patch])
    applied = result.code === 0
    if (applied) options.onEvent?.({ kind: 'applied', id: winner.id })
    rmSync(patch, { force: true })
  }

  if (!options.keep && !options.dryRun && !options.runner) {
    for (const candidate of candidates) {
      if (candidate.worktree && candidate.branch) {
        await removeWorktree(cwd, candidate.worktree, candidate.branch)
      }
    }
  }

  // Automatic learning: a tournament is a strong routing signal. The winner's
  // model gets a pass for this category; explicit judged failures get a fail.
  // Candidates that merely lost to a better diff are not counted as failures.
  if (!options.dryRun) {
    for (const candidate of candidates) {
      const isWinner = winner?.id === candidate.id
      const judgedFail = candidate.isError || candidate.verdict === 'FAIL'
      if (!isWinner && !judgedFail) continue
      recordOutcome(cwd, {
        id: `arena-${runId}-${candidate.id}`,
        task,
        model: candidate.model ?? null,
        pass: isWinner && !judgedFail,
        detail: `arena ${isWinner ? 'winner' : 'failed candidate'}: ${task.slice(0, 80)}`,
      })
    }
  }

  return { task: task.trim(), agents, candidates: ranked, winner, applied }
}

export function formatArenaResult(result: ArenaResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `Arena: ${result.task}`,
    `Agents: ${result.agents}   Winner: ${result.winner?.id ?? 'none'}${
      result.applied ? ' (applied)' : ''
    }`,
    '',
    'Ranking:',
  ]
  for (const c of result.candidates) {
    const flag = c === result.winner ? '★' : ' '
    lines.push(
      `${flag} ${c.id} [${c.model ?? 'auto'}]  score ${c.score}  (${c.reasons.join(', ')})`,
    )
  }
  if (result.winner && !result.applied && result.winner.diff.trim()) {
    lines.push('', 'Apply the winner with: ur arena "<task>" --apply')
  }
  return lines.join('\n')
}
