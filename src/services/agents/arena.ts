/**
 * Verified best-of-N arena.
 *
 * Candidates run in detached worktrees. Safety/verification decides
 * eligibility before any judge sees them. Model judges receive bounded,
 * anonymous diffs through a strict schema; malformed decisions fail closed.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { reviewDiff, type ReviewFinding } from '../../commands/agent-task/selfReview.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import {
  isSecretLikeSubprocessEnvName,
  strictGitSubprocessEnv,
} from '../../utils/subprocessEnv.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import { recordOutcome } from './learning.js'
import { redactAgenticCiText } from './agenticCi.js'
import { addRunArtifact, runArtifactsDir } from './runArtifacts.js'
import { runStructured } from './structuredRun.js'

export const MAX_ARENA_DIFF_BYTES = 1024 * 1024
export const MAX_ARENA_JUDGE_DIFF_CHARS = 40_000
export const MAX_ARENA_CHECK_LOG_CHARS = 8_000
export const MAX_ARENA_RUBRIC_CHARS = 8_000

export function redactArenaText(value: string): string {
  return redactAgenticCiText(value)
}

export type ArenaJudgeMode = 'deterministic' | 'model' | 'hybrid'

export type ArenaVerificationCommand = {
  name?: string
  file: string
  args?: string[]
  timeoutMs?: number
}

export type ArenaCheck = {
  name: string
  command: string[]
  exitCode: number
  stdoutTail: string
  stderrTail: string
}

export type ArenaVerification = {
  passed: boolean
  checks: ArenaCheck[]
}

export type Candidate = {
  id: string
  model?: string
  worktree?: string
  branch?: string
  diff: string
  output: string
  verdict: string | null
  isError: boolean
  verification?: ArenaVerification
  policyViolations?: string[]
}

export type ScoredCandidate = Candidate & {
  score: number
  changedLines: number
  blocking: number
  warnings: number
  reasons: string[]
  eligible: boolean
  eligibilityReasons: string[]
}

export type ArenaModelDecision = {
  winnerId: string | null
  ranking: string[]
  confidence: number
  rationale: string
}

export type AnonymousArenaCandidate = {
  id: string
  diff: string
  diffTruncated: boolean
  originalBytes: number
  verification: { passed: boolean; checks: string[] }
  safety: { blocking: number; warnings: number }
  deterministicScore?: number
}

export type ArenaModelJudge = (input: {
  task: string
  rubric: string
  candidates: AnonymousArenaCandidate[]
}) => Promise<unknown>

export type ArenaDecision = {
  mode: ArenaJudgeMode
  valid: boolean
  reason: string
  model?: ArenaModelDecision
}

function countChangedLines(diff: string): number {
  let count = 0
  for (const line of diff.split('\n')) {
    if (
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      count += 1
    }
  }
  return count
}

/** Pure deterministic scoring. Eligibility remains a separate fail-closed gate. */
export function scoreCandidate(candidate: Candidate): ScoredCandidate {
  const findings: ReviewFinding[] = reviewDiff(candidate.diff)
  const blocking = findings.filter(finding => finding.severity === 'block').length
  const warnings = findings.filter(finding => finding.severity === 'warn').length
  const changedLines = countChangedLines(candidate.diff)
  const reasons: string[] = []
  const eligibilityReasons = [...(candidate.policyViolations ?? [])]
  let score = 0

  if (candidate.isError) {
    score -= 10
    reasons.push('run errored')
    eligibilityReasons.push('run errored')
  }
  if (candidate.verdict === 'PASS') {
    score += 5
    reasons.push('verdict PASS')
  } else if (candidate.verdict === 'PARTIAL') {
    score += 1
    reasons.push('verdict PARTIAL')
    eligibilityReasons.push('candidate did not return PASS')
  } else {
    score -= 5
    reasons.push(`verdict ${candidate.verdict ?? 'missing'}`)
    eligibilityReasons.push('candidate did not return PASS')
  }
  if (changedLines === 0) {
    score -= 6
    reasons.push('empty diff (no change)')
    eligibilityReasons.push('empty diff')
  } else {
    score += 2
    reasons.push(`${changedLines} changed lines`)
  }
  if (blocking > 0) {
    score -= 8 * Math.min(blocking, 3)
    reasons.push(`${blocking} blocking finding(s)`)
    eligibilityReasons.push(`${blocking} blocking safety finding(s)`)
  }
  if (warnings > 0) {
    score -= warnings
    reasons.push(`${warnings} warning(s)`)
  }
  if (candidate.verification && !candidate.verification.passed) {
    score -= 10
    reasons.push('verification failed')
    eligibilityReasons.push('verification failed')
  }
  score -= changedLines * 0.001

  return {
    ...candidate,
    score: Number(score.toFixed(3)),
    changedLines,
    blocking,
    warnings,
    reasons,
    eligible: eligibilityReasons.length === 0,
    eligibilityReasons: [...new Set(eligibilityReasons)],
  }
}

export type Judgement = {
  ranked: ScoredCandidate[]
  winner: ScoredCandidate | null
}

export function judge(candidates: Candidate[]): Judgement {
  const ranked = candidates
    .map(scoreCandidate)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
  return {
    ranked,
    winner: ranked.find(candidate => candidate.eligible) ?? null,
  }
}

function isArenaModelDecision(
  value: unknown,
  candidateIds: string[],
): value is ArenaModelDecision {
  if (!value || typeof value !== 'object') return false
  const decision = value as Record<string, unknown>
  const allowed = new Set(candidateIds)
  const ranking = decision.ranking
  const winnerId = decision.winnerId
  return (
    (winnerId === null ||
      (typeof winnerId === 'string' && allowed.has(winnerId))) &&
    Array.isArray(ranking) &&
    ranking.length === candidateIds.length &&
    new Set(ranking).size === ranking.length &&
    ranking.every(id => typeof id === 'string' && allowed.has(id)) &&
    typeof decision.confidence === 'number' &&
    Number.isFinite(decision.confidence) &&
    decision.confidence >= 0 &&
    decision.confidence <= 1 &&
    typeof decision.rationale === 'string' &&
    decision.rationale.length <= 2_000
  )
}

function anonymousCandidates(
  eligible: ScoredCandidate[],
  mode: ArenaJudgeMode,
): {
  candidates: AnonymousArenaCandidate[]
  anonymousToReal: Map<string, string>
} {
  const anonymousToReal = new Map<string, string>()
  const candidates = eligible.map((candidate, index) => {
    const id = `candidate-${index + 1}`
    anonymousToReal.set(id, candidate.id)
    const redactedDiff = redactArenaText(candidate.diff)
    const originalBytes = Buffer.byteLength(redactedDiff)
    const diffBuffer = Buffer.from(redactedDiff)
    const diffTruncated = diffBuffer.byteLength > MAX_ARENA_JUDGE_DIFF_CHARS
    const diff = diffTruncated
      ? [
          diffBuffer
            .subarray(0, Math.floor(MAX_ARENA_JUDGE_DIFF_CHARS / 2))
            .toString('utf8'),
          '\n... [middle omitted: candidate is not judge-eligible] ...\n',
          diffBuffer
            .subarray(
              diffBuffer.byteLength -
                Math.floor(MAX_ARENA_JUDGE_DIFF_CHARS / 2),
            )
            .toString('utf8'),
        ].join('')
      : redactedDiff
    return {
      id,
      diff,
      diffTruncated,
      originalBytes,
      verification: {
        passed: candidate.verification?.passed ?? true,
        checks:
          candidate.verification?.checks.map(check => check.name).slice(0, 32) ??
          [],
      },
      safety: {
        blocking: candidate.blocking,
        warnings: candidate.warnings,
      },
      ...(mode === 'hybrid'
        ? { deterministicScore: candidate.score }
        : {}),
    }
  })
  return { candidates, anonymousToReal }
}

export async function judgeArenaCandidates(
  task: string,
  ranked: ScoredCandidate[],
  options: {
    mode: ArenaJudgeMode
    rubric?: string
    modelJudge?: ArenaModelJudge
  },
): Promise<{
  ranked: ScoredCandidate[]
  winner: ScoredCandidate | null
  decision: ArenaDecision
}> {
  if (options.mode === 'deterministic') {
    return {
      ranked,
      winner: ranked.find(candidate => candidate.eligible) ?? null,
      decision: {
        mode: 'deterministic',
        valid: true,
        reason: 'deterministic safety and score ranking',
      },
    }
  }
  const judgeRanked = ranked.map(candidate => {
    if (
      candidate.eligible &&
      Buffer.byteLength(redactArenaText(candidate.diff)) >
        MAX_ARENA_JUDGE_DIFF_CHARS
    ) {
      return {
        ...candidate,
        eligible: false,
        eligibilityReasons: [
          ...candidate.eligibilityReasons,
          `redacted diff exceeds ${MAX_ARENA_JUDGE_DIFF_CHARS}-byte model-judge limit`,
        ],
      }
    }
    return candidate
  })
  const eligible = judgeRanked.filter(candidate => candidate.eligible)
  if (eligible.length === 0) {
    return {
      ranked: judgeRanked,
      winner: null,
      decision: {
        mode: options.mode,
        valid: false,
        reason: 'no eligible candidates',
      },
    }
  }
  if (!options.modelJudge) {
    return {
      ranked: judgeRanked,
      winner: null,
      decision: {
        mode: options.mode,
        valid: false,
        reason: 'model judge unavailable',
      },
    }
  }
  const anonymous = anonymousCandidates(eligible, options.mode)
  let raw: unknown
  try {
    raw = await options.modelJudge({
      task: redactArenaText(task).slice(0, 32_000),
      rubric: redactArenaText(
        options.rubric ??
          'Choose the smallest complete, correct, maintainable implementation. Penalize regressions, unnecessary scope, and unsafe behavior.',
      ).slice(0, MAX_ARENA_RUBRIC_CHARS),
      candidates: anonymous.candidates,
    })
  } catch (error) {
    return {
      ranked: judgeRanked,
      winner: null,
      decision: {
        mode: options.mode,
        valid: false,
        reason: `model judge failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    }
  }
  const ids = anonymous.candidates.map(candidate => candidate.id)
  if (!isArenaModelDecision(raw, ids)) {
    return {
      ranked: judgeRanked,
      winner: null,
      decision: {
        mode: options.mode,
        valid: false,
        reason: 'model decision failed strict schema/candidate validation',
      },
    }
  }
  const realRanking = raw.ranking
    .map(id => anonymous.anonymousToReal.get(id))
    .filter((id): id is string => Boolean(id))
  const byId = new Map(judgeRanked.map(candidate => [candidate.id, candidate]))
  const reranked = [
    ...realRanking.map(id => byId.get(id)).filter((item): item is ScoredCandidate => Boolean(item)),
    ...judgeRanked.filter(candidate => !realRanking.includes(candidate.id)),
  ]
  const realWinnerId =
    raw.winnerId === null
      ? null
      : anonymous.anonymousToReal.get(raw.winnerId) ?? null
  const winner = realWinnerId ? byId.get(realWinnerId) ?? null : null
  if (winner && !winner.eligible) {
    return {
      ranked: judgeRanked,
      winner: null,
      decision: {
        mode: options.mode,
        valid: false,
        reason: 'model selected an ineligible candidate',
      },
    }
  }
  return {
    ranked: reranked,
    winner,
    decision: {
      mode: options.mode,
      valid: true,
      reason: winner ? 'strict model decision accepted' : 'model selected no winner',
      model: {
        ...raw,
        winnerId: realWinnerId,
        ranking: realRanking,
      },
    },
  }
}

function arenaDecisionSchema(candidateIds: string[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['winnerId', 'ranking', 'confidence', 'rationale'],
    properties: {
      winnerId: { type: ['string', 'null'], enum: [...candidateIds, null] },
      ranking: {
        type: 'array',
        minItems: candidateIds.length,
        maxItems: candidateIds.length,
        uniqueItems: true,
        items: { type: 'string', enum: candidateIds },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string', minLength: 1, maxLength: 2_000 },
    },
  }
}

export function makeArenaModelJudge(
  runner: HeadlessRunner,
  options: { cwd: string; model?: string; maxTurns?: number },
): ArenaModelJudge {
  return async input => {
    const schema = arenaDecisionSchema(input.candidates.map(candidate => candidate.id))
    const result = await runStructured(runner, {
      cwd: options.cwd,
      model: options.model,
      maxTurns: 1,
      timeoutMs: 10 * 60_000,
      tools: [],
      noSessionPersistence: true,
      env: {
        ...process.env,
        UR_CODE_SUBPROCESS_ENV_SCRUB: '1',
      },
      schema,
      repairRounds: 1,
      prompt: [
        'Act as an impartial code-change tournament judge.',
        'Candidate identities and model names are intentionally hidden.',
        `Task: ${input.task}`,
        `Rubric: ${input.rubric}`,
        `Candidates: ${JSON.stringify(input.candidates)}`,
        'Select only a candidate that fully satisfies the task and passed all gates. Use null when none is acceptable.',
      ].join('\n\n'),
    })
    return result.ok ? result.data : null
  }
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
  judgeMode?: ArenaJudgeMode
  judgeModel?: string
  judgeRubric?: string
  modelJudge?: ArenaModelJudge
  verify?: ArenaVerificationCommand[]
  onEvent?: (event: ArenaEvent) => void
}

export type ArenaEvent =
  | { kind: 'start'; id: string; model?: string }
  | { kind: 'done'; id: string; verdict: string | null; isError: boolean }
  | { kind: 'applied'; id: string }

export type ArenaResult = {
  runId: string
  task: string
  agents: number
  judgeMode: ArenaJudgeMode
  decision: ArenaDecision
  candidates: ScoredCandidate[]
  winner: ScoredCandidate | null
  applied: boolean
  artifactPath: string
}

type GitResult = { stdout: string; stderr: string; code: number }

async function git(cwd: string, args: string[]): Promise<GitResult> {
  const result = await execFileNoThrowWithCwd(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'diff.external=',
      ...args,
    ],
    {
    cwd,
    timeout: 60_000,
    preserveOutputOnError: true,
    env: strictGitSubprocessEnv(),
    extendEnv: false,
    maxBuffer: 2 * 1024 * 1024,
    },
  )
  return {
    stdout: result.stdout,
    stderr: result.stderr || result.error || '',
    code: result.code,
  }
}

export async function createArenaWorktree(
  cwd: string,
  root: string,
  id: string,
  baseSha: string,
): Promise<{ path: string } | null> {
  const path = join(root, id)
  if (existsSync(path)) return null
  mkdirSync(root, { recursive: true })
  const filters = await git(cwd, [
    'config',
    '--get-regexp',
    '^filter\\..*\\.(clean|process)$',
  ])
  if (
    (filters.code === 0 && filters.stdout.trim()) ||
    (filters.code !== 0 && filters.code !== 1)
  ) {
    return null
  }
  const result = await git(cwd, [
    'worktree',
    'add',
    '--detach',
    path,
    baseSha,
  ])
  return result.code === 0 ? { path } : null
}

export async function captureArenaDiff(
  worktree: string,
): Promise<{ diff: string; violation?: string }> {
  const filters = await git(worktree, [
    'config',
    '--get-regexp',
    '^filter\\..*\\.(clean|process)$',
  ])
  if (filters.code === 0 && filters.stdout.trim()) {
    return {
      diff: '',
      violation:
        'configured Git clean/process filters are not allowed in arena candidates',
    }
  }
  if (filters.code !== 0 && filters.code !== 1) {
    return {
      diff: '',
      violation: 'failed to inspect candidate Git filters',
    }
  }
  const staged = await git(worktree, ['add', '-A'])
  if (staged.code !== 0) {
    return { diff: '', violation: 'failed to stage candidate changes' }
  }
  const result = await git(worktree, [
    'diff',
    '--cached',
    '--no-ext-diff',
    '--no-textconv',
    '--binary',
  ])
  if (result.code !== 0) {
    return { diff: '', violation: 'failed to capture candidate diff' }
  }
  const bytes = Buffer.byteLength(result.stdout, 'utf8')
  if (bytes > MAX_ARENA_DIFF_BYTES) {
    return {
      diff: '',
      violation: `candidate diff exceeds ${MAX_ARENA_DIFF_BYTES} bytes`,
    }
  }
  return { diff: result.stdout }
}

function tail(value: string, max = MAX_ARENA_CHECK_LOG_CHARS): string {
  return value.length <= max ? value : value.slice(-max)
}

export async function verifyCandidate(
  cwd: string,
  commands: ArenaVerificationCommand[],
  expectedDiff?: string,
): Promise<ArenaVerification> {
  if (commands.length > 32) {
    return {
      passed: false,
      checks: [
        {
          name: 'verification command limit',
          command: [],
          exitCode: 126,
          stdoutTail: '',
          stderrTail: 'at most 32 verification commands are allowed',
        },
      ],
    }
  }
  const checks: ArenaCheck[] = []
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !isSecretLikeSubprocessEnvName(key) &&
        !['SSH_AUTH_SOCK', 'GITHUB_TOKEN', 'GH_TOKEN'].includes(key),
    ),
  )
  env.UR_CODE_SUBPROCESS_ENV_SCRUB = '1'
  for (const command of commands) {
    if (
      !command.file ||
      /[\0\r\n]/.test(command.file) ||
      (command.args ?? []).some(arg => arg.includes('\0'))
    ) {
      checks.push({
        name: command.name ?? 'invalid command',
        command: [command.file, ...(command.args ?? [])],
        exitCode: 126,
        stdoutTail: '',
        stderrTail: 'invalid verification command',
      })
      break
    }
    const result = await execFileNoThrowWithCwd(
      command.file,
      command.args ?? [],
      {
        cwd,
        timeout: Math.min(
          Math.max(command.timeoutMs ?? 5 * 60_000, 1_000),
          30 * 60_000,
        ),
        preserveOutputOnError: true,
        env,
        extendEnv: false,
        maxBuffer: MAX_ARENA_CHECK_LOG_CHARS * 4,
      },
    )
    checks.push({
      name: command.name ?? [command.file, ...(command.args ?? [])].join(' '),
      command: [command.file, ...(command.args ?? [])],
      exitCode: result.code,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr || result.error || ''),
    })
    if (result.code !== 0) break
  }
  if (expectedDiff !== undefined) {
    const afterChecks = await captureArenaDiff(cwd)
    const unchanged =
      !afterChecks.violation && afterChecks.diff === expectedDiff
    checks.push({
      name: 'verification patch integrity',
      command: ['git', 'diff', '--cached', '--no-ext-diff', '--binary'],
      exitCode: unchanged ? 0 : 1,
      stdoutTail: '',
      stderrTail: unchanged
        ? ''
        : afterChecks.violation ??
          'verification commands modified the candidate patch',
    })
  }
  return { passed: checks.every(check => check.exitCode === 0), checks }
}

async function removeWorktree(cwd: string, worktree: string): Promise<void> {
  await git(cwd, ['worktree', 'remove', '--force', worktree])
  await git(cwd, ['worktree', 'prune'])
  rmSync(worktree, { recursive: true, force: true })
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sanitizeCandidate(
  candidate: ScoredCandidate,
  retainWorktree = false,
): ScoredCandidate {
  return {
    ...candidate,
    worktree: retainWorktree ? candidate.worktree : undefined,
    branch: undefined,
    diff: redactArenaText(candidate.diff),
    output: redactArenaText(candidate.output),
    reasons: candidate.reasons.map(redactArenaText),
    eligibilityReasons: candidate.eligibilityReasons.map(redactArenaText),
    verification: candidate.verification
      ? {
          ...candidate.verification,
          checks: candidate.verification.checks.map(check => ({
            ...check,
            stdoutTail: redactArenaText(check.stdoutTail),
            stderrTail: redactArenaText(check.stderrTail),
          })),
        }
      : undefined,
  }
}

async function applyWinner(
  cwd: string,
  baseSha: string,
  runId: string,
  winner: ScoredCandidate,
): Promise<boolean> {
  const [head, status] = await Promise.all([
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']),
  ])
  if (head.code !== 0 || head.stdout.trim() !== baseSha) {
    throw new Error('refusing to apply: repository HEAD changed during arena run')
  }
  if (status.code !== 0 || status.stdout.trim()) {
    throw new Error('refusing to apply: repository worktree is not clean')
  }
  const digest = sha256(winner.diff)
  const patch = join(cwd, '.ur', 'arena', runId, `winner-${digest}.patch`)
  mkdirSync(dirname(patch), { recursive: true })
  writeFileSync(patch, winner.diff, { mode: 0o600 })
  const check = await git(cwd, ['apply', '--check', '--3way', patch])
  if (check.code !== 0) {
    throw new Error(`winner patch failed git apply --check: ${check.stderr}`)
  }
  const applied = await git(cwd, ['apply', '--3way', patch])
  return applied.code === 0
}

function writeArenaArtifact(
  cwd: string,
  result: Omit<ArenaResult, 'artifactPath'>,
): string {
  const dir = runArtifactsDir(cwd, result.runId)
  const path = join(dir, 'arena-report.json')
  mkdirSync(dir, { recursive: true })
  const safe = {
    version: 1,
    runId: result.runId,
    taskHash: sha256(result.task),
    agents: result.agents,
    judgeMode: result.judgeMode,
    decision: {
      ...result.decision,
      reason: redactArenaText(result.decision.reason),
      model: result.decision.model
        ? {
            ...result.decision.model,
            rationale: redactArenaText(result.decision.model.rationale),
          }
        : undefined,
    },
    winnerId: result.winner?.id ?? null,
    applied: result.applied,
    candidates: result.candidates.map(candidate => ({
      id: candidate.id,
      model: candidate.model,
      verdict: candidate.verdict,
      isError: candidate.isError,
      score: candidate.score,
      eligible: candidate.eligible,
      eligibilityReasons: candidate.eligibilityReasons.map(redactArenaText),
      changedLines: candidate.changedLines,
      blocking: candidate.blocking,
      warnings: candidate.warnings,
      verification: candidate.verification
        ? {
            ...candidate.verification,
            checks: candidate.verification.checks.map(check => ({
              ...check,
              stdoutTail: redactArenaText(check.stdoutTail),
              stderrTail: redactArenaText(check.stderrTail),
            })),
          }
        : undefined,
      diffSha256: candidate.diff ? sha256(candidate.diff) : null,
      diffBytes: Buffer.byteLength(candidate.diff, 'utf8'),
    })),
  }
  writeFileSync(path, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 })
  addRunArtifact(cwd, result.runId, {
    kind: 'report',
    path: 'arena-report.json',
    title: 'Arena report',
  })
  return path
}

export async function runArena(
  task: string,
  options: RunArenaOptions,
): Promise<ArenaResult> {
  const cwd = options.cwd
  const cleanTask = task.trim()
  if (!cleanTask || cleanTask.length > 32_000) {
    throw new Error('Arena task must contain 1–32000 characters.')
  }
  const requestedAgents = options.agents ?? 3
  if (
    !Number.isInteger(requestedAgents) ||
    requestedAgents < 2 ||
    requestedAgents > 8
  ) {
    throw new Error('Arena agents must be an integer between 2 and 8.')
  }
  const mode = options.judgeMode ?? 'deterministic'
  if (!['deterministic', 'model', 'hybrid'].includes(mode)) {
    throw new Error('Arena judge mode must be deterministic, model, or hybrid.')
  }
  if (
    options.judgeRubric !== undefined &&
    (options.judgeRubric.trim().length === 0 ||
      options.judgeRubric.length > MAX_ARENA_RUBRIC_CHARS)
  ) {
    throw new Error(
      `Arena judge rubric must contain 1–${MAX_ARENA_RUBRIC_CHARS} characters.`,
    )
  }
  if ((options.verify?.length ?? 0) > 32) {
    throw new Error('Arena allows at most 32 verification commands.')
  }
  const base = await git(cwd, ['rev-parse', 'HEAD'])
  const validBase =
    base.code === 0 && /^[0-9a-f]{40,64}$/i.test(base.stdout.trim())
  if (!validBase && !options.runner && !options.dryRun) {
    throw new Error('Arena requires a git repository with a valid HEAD.')
  }
  if (!validBase && options.apply) {
    throw new Error('Arena apply requires a git repository with a valid HEAD.')
  }
  const baseSha = validBase ? base.stdout.trim() : ''
  const agents = requestedAgents
  const runner =
    options.runner ??
    (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const prompt = `${cleanTask}\n\nImplement this fully and correctly. Make focused changes. End your reply with VERDICT: PASS or VERDICT: FAIL.`
  const worktrees: string[] = []
  const worktreeRoot =
    !options.dryRun && !options.runner
      ? mkdtempSync(join(tmpdir(), `ur-arena-${runId}-`))
      : undefined
  let judgeCwd: string | undefined
  let candidates: Candidate[] = []

  try {
    const ids = Array.from({ length: agents }, (_, index) => `c${index + 1}`)
    candidates = await Promise.all(
      ids.map(async (id, index): Promise<Candidate> => {
        const model = options.models?.[index]
        options.onEvent?.({ kind: 'start', id, model })
        let worktree: string | undefined
        let workCwd = cwd
        if (!options.dryRun && !options.runner) {
          const created = await createArenaWorktree(
            cwd,
            worktreeRoot!,
            id,
            baseSha,
          )
          if (!created) {
            options.onEvent?.({
              kind: 'done',
              id,
              verdict: 'FAIL',
              isError: true,
            })
            return {
              id,
              model,
              diff: '',
              output: 'Failed to create isolated worktree.',
              verdict: 'FAIL',
              isError: true,
              policyViolations: ['worktree isolation failed'],
            }
          }
          worktree = created.path
          worktrees.push(worktree)
          workCwd = worktree
        }
        let output: Awaited<ReturnType<HeadlessRunner>>
        try {
          output = await runner({
            cwd: workCwd,
            prompt,
            model,
            maxTurns: options.maxTurns,
            skipPermissions: options.skipPermissions,
            env: {
              ...process.env,
              UR_CODE_SUBPROCESS_ENV_SCRUB: '1',
            },
          })
        } catch (error) {
          output = {
            output: error instanceof Error ? error.message : String(error),
            verdict: 'FAIL',
            isError: true,
          }
        }
        const captured =
          worktree && !options.dryRun
            ? await captureArenaDiff(worktree)
            : { diff: '' }
        const verification =
          worktree && captured.diff && !captured.violation
            ? await verifyCandidate(
                worktree,
                options.verify ?? [],
                captured.diff,
              )
            : { passed: (options.verify?.length ?? 0) === 0, checks: [] }
        options.onEvent?.({
          kind: 'done',
          id,
          verdict: output.verdict ?? null,
          isError: Boolean(output.isError),
        })
        return {
          id,
          model,
          worktree,
          diff: captured.diff,
          output: output.output,
          verdict: output.verdict ?? null,
          isError: Boolean(output.isError),
          verification,
          policyViolations: captured.violation ? [captured.violation] : [],
        }
      }),
    )

    const deterministic = judge(candidates)
    const modelJudge =
      options.modelJudge ??
      (mode === 'deterministic'
        ? undefined
        : (() => {
            judgeCwd = mkdtempSync(join(tmpdir(), 'ur-arena-judge-'))
            return makeArenaModelJudge(defaultHeadlessRunner(), {
              cwd: judgeCwd,
              model: options.judgeModel,
              maxTurns: 1,
            })
          })())
    const judged = await judgeArenaCandidates(cleanTask, deterministic.ranked, {
      mode,
      rubric: options.judgeRubric,
      modelJudge,
    })

    let applied = false
    if (options.apply && judged.winner && !options.dryRun) {
      applied = await applyWinner(cwd, baseSha, runId, judged.winner)
      if (applied) {
        options.onEvent?.({ kind: 'applied', id: judged.winner.id })
      }
    }

    if (!options.dryRun) {
      for (const candidate of candidates) {
        const isWinner = judged.winner?.id === candidate.id
        const judgedFail = candidate.isError || candidate.verdict === 'FAIL'
        if (!isWinner && !judgedFail) continue
        recordOutcome(cwd, {
          id: `arena-${runId}-${candidate.id}`,
          task: cleanTask,
          model: candidate.model ?? null,
          pass: isWinner && !judgedFail,
          detail: `arena ${isWinner ? 'winner' : 'failed candidate'}: ${cleanTask.slice(0, 80)}`,
        })
      }
    }

    const safeCandidates = judged.ranked.map(candidate =>
      sanitizeCandidate(candidate, options.keep),
    )
    const safeWinner = judged.winner
      ? safeCandidates.find(candidate => candidate.id === judged.winner?.id) ??
        null
      : null
    const safeDecision: ArenaDecision = {
      ...judged.decision,
      reason: redactArenaText(judged.decision.reason),
      model: judged.decision.model
        ? {
            ...judged.decision.model,
            rationale: redactArenaText(judged.decision.model.rationale),
          }
        : undefined,
    }
    const partial: Omit<ArenaResult, 'artifactPath'> = {
      runId,
      task: redactArenaText(cleanTask),
      agents,
      judgeMode: mode,
      decision: safeDecision,
      candidates: safeCandidates,
      winner: safeWinner,
      applied,
    }
    if (options.dryRun) {
      return { ...partial, artifactPath: '' }
    }
    const artifactPath = writeArenaArtifact(cwd, partial)
    return { ...partial, artifactPath }
  } finally {
    if (!options.keep && !options.dryRun && !options.runner) {
      for (const worktree of worktrees) {
        await removeWorktree(cwd, worktree)
      }
      if (worktreeRoot) {
        rmSync(worktreeRoot, { recursive: true, force: true })
      }
    }
    if (judgeCwd) rmSync(judgeCwd, { recursive: true, force: true })
  }
}

export function formatArenaResult(result: ArenaResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `Arena: ${result.task}`,
    `Agents: ${result.agents}   Judge: ${result.judgeMode}   Winner: ${
      result.winner?.id ?? 'none'
    }${result.applied ? ' (applied)' : ''}`,
    `Decision: ${result.decision.valid ? 'valid' : 'invalid'} — ${result.decision.reason}`,
    result.artifactPath ? `Artifact: ${result.artifactPath}` : 'Artifact: none (dry run)',
    '',
    'Ranking:',
  ]
  for (const candidate of result.candidates) {
    const flag = candidate.id === result.winner?.id ? '★' : ' '
    lines.push(
      `${flag} ${candidate.id} [${candidate.model ?? 'auto'}] score ${
        candidate.score
      } ${candidate.eligible ? 'eligible' : `blocked: ${candidate.eligibilityReasons.join(', ')}`}`,
    )
  }
  return lines.join('\n')
}
