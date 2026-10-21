/**
 * Spec verifier — a strict, evidence-driven verification stage for spec-driven
 * development. This is the first concrete kernel role: verifier must be
 * stricter than the generator and require compile/test/lint/diff/runtime proof
 * before any PASS claim.
 *
 * The flow is intentionally simple so a future AgentKernel can call it as a
 * stage without change:
 *   1. Deterministic project gates from .ur/verify.json (cheap, fast fail).
 *   2. Deep verification subagent (read-only, adversarial, evidence-based).
 *   3. Persisted record + human-readable verification.md.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import type { AgentKernel } from './kernel.js'
import type { SpecMeta, SpecTask } from './spec.js'
import { loadVerifyConfig, runGateCommands } from '../verifier/projectGates.js'
import type { Verdict } from './executor.js'
import { runExecutionBoundVerification } from './runVerification.js'
import { captureVerificationState, type VerificationEvidence } from '../verifier/executionEvidence.js'
import { evaluateVerificationProofs, REQUIRED_VERIFICATION_PROOFS, type VerificationProofCheck } from './verificationProofs.js'

export type SpecVerifyRecord = {
  version: 1 | 2
  verdict: Verdict
  summary: string
  commandFailures: number
  generatedAt: string
  freshness?: 'current' | 'stale' | 'unverifiable'
  stateSha256?: string
  runId?: string
  legacyVerdict?: Verdict
  executions?: Array<{
    id: string; commandSha256: string; exitCode: number | null
    beforeStateSha256?: string; afterStateSha256?: string
  }>
  proofs?: VerificationProofCheck['executionIds']
}

export type GateResult =
  | { ok: true; command: string; ranCommands: number }
  | { ok: false; command: string; exitCode: number | null; stdout: string; stderr: string }

export type SpecVerifyEvidence = {
  spec: SpecMeta
  requirements: string
  design: string
  tasks: SpecTask[]
  changedFiles: string[]
  diff: string
  priorVerifications: SpecVerifyRecord[]
}

export type SpecVerifyResult = {
  verdict: Verdict
  summary: string
  commandFailures: number
  gateResults: GateResult[]
  subagentOutput: string
  generatedAt: string
  evidence?: VerificationEvidence
}

export type SpecVerifyOptions = {
  runner?: HeadlessRunner
  skipPermissions?: boolean
  maxTurns?: number
  dryRun?: boolean
  kernel?: AgentKernel
}

const RECORD_FILE = 'verification.json'
const REPORT_FILE = 'verification.md'
const MAX_DIFF_CHARS = 12_000

function recordPath(cwd: string, name: string): string {
  return join(cwd, '.ur', 'specs', name, RECORD_FILE)
}

function reportPath(cwd: string, name: string): string {
  return join(cwd, '.ur', 'specs', name, REPORT_FILE)
}

export async function loadVerificationRecord(cwd: string, name: string, options: { migrateLegacy?: boolean } = {}): Promise<SpecVerifyRecord | null> {
  const path = recordPath(cwd, name)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as SpecVerifyRecord
  if (![1, 2].includes(record.version) || !['PASS', 'FAIL', 'PARTIAL'].includes(record.verdict) ||
    typeof record.summary !== 'string' || typeof record.generatedAt !== 'string' ||
    !Number.isSafeInteger(record.commandFailures) || record.commandFailures < 0) return null
  if (record.version === 1) {
    const migrated: SpecVerifyRecord = {
      ...record, version: 2, freshness: 'unverifiable', legacyVerdict: record.verdict,
      verdict: record.verdict === 'PASS' ? 'PARTIAL' : record.verdict,
      summary: `${record.summary} [Legacy verification has no execution-bound source evidence; rerun verification.]`,
    }
    if (options.migrateLegacy !== false) saveVerificationRecord(cwd, name, migrated)
    return migrated
  }
  let current: string | undefined
  try { current = (await captureVerificationState(cwd)).sha256 } catch { /* Unavailable evidence cannot establish a current PASS. */ }
  const proofBound = REQUIRED_VERIFICATION_PROOFS.every(kind =>
    Array.isArray(record.executions) && record.executions.some(execution =>
      execution.id === record.proofs?.[kind] && execution.exitCode === 0 &&
      /^[a-f0-9]{64}$/u.test(execution.commandSha256) &&
      execution.beforeStateSha256 === record.stateSha256 && execution.afterStateSha256 === record.stateSha256))
  const freshness = record.verdict === 'PASS' && !proofBound ? 'unverifiable' : record.stateSha256 && current
    ? record.stateSha256 === current ? 'current' : 'stale'
    : 'unverifiable'
  return {
    ...record, freshness,
    ...(record.verdict === 'PASS' && freshness !== 'current'
      ? { verdict: 'PARTIAL' as const, summary: `${record.summary} [${freshness} source evidence; rerun verification.]` }
      : {}),
  }
}

export async function listVerificationRecords(cwd: string, name: string): Promise<SpecVerifyRecord[]> {
  const records: SpecVerifyRecord[] = []
  const current = await loadVerificationRecord(cwd, name)
  // Future: append-only log. For now, one current record.
  if (current) records.push(current)
  return records
}

export function saveVerificationRecord(cwd: string, name: string, record: SpecVerifyRecord): void {
  const path = recordPath(cwd, name)
  mkdirSync(join(cwd, '.ur', 'specs', name), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
}

/** One persistence path for direct and kernel spec verification. Raw command output stays in its existing transcript. */
export function persistVerificationResult(cwd: string, name: string, result: SpecVerifyResult): void {
  const evidence = result.evidence
  saveVerificationRecord(cwd, name, {
    version: 2, verdict: result.verdict, summary: result.summary,
    commandFailures: result.commandFailures, generatedAt: result.generatedAt,
    freshness: evidence?.stateSha256 ? 'current' : 'unverifiable',
    stateSha256: evidence?.stateSha256, runId: evidence?.runId,
    proofs: evaluateVerificationProofs(result.subagentOutput, evidence).executionIds,
    executions: evidence?.executions.map(execution => ({
      id: execution.id, commandSha256: createHash('sha256').update(execution.command).digest('hex'),
      exitCode: execution.exitCode, beforeStateSha256: execution.beforeStateSha256,
      afterStateSha256: execution.afterStateSha256,
    })),
  })
  writeVerificationReport(cwd, name, result)
}

export function writeVerificationReport(
  cwd: string,
  name: string,
  result: SpecVerifyResult,
): void {
  const lines = [
    `# Verification: ${name}`,
    '',
    `- Verdict: **${result.verdict}**`,
    `- Generated: ${result.generatedAt}`,
    `- Command failures: ${result.commandFailures}`,
    '',
    '## Summary',
    '',
    result.summary,
    '',
    '## Gate results',
    '',
    ...result.gateResults.map(g =>
      g.ok
        ? `- ✓ \`${g.command}\` passed`
        : `- ✗ \`${g.command}\` failed (exit ${(g as GateResult & { ok: false }).exitCode ?? 'killed'})`,
    ),
    '',
    '## Execution evidence',
    `Run: ${result.evidence?.runId ?? 'unavailable'}`,
    `Source SHA-256: ${result.evidence?.stateSha256 ?? 'unavailable'}`,
    ...(result.evidence?.executions ?? []).map(execution =>
      `- execution:${execution.id}: exit=${execution.exitCode ?? 'unknown'}; before=${execution.beforeStateSha256 ?? 'unknown'}; after=${execution.afterStateSha256 ?? 'unknown'}`),
    '',
    '## Subagent output',
    '',
    '```',
    result.subagentOutput,
    '```',
    '',
  ]
  writeFileSync(reportPath(cwd, name), lines.join('\n'))
}

async function captureDiff(cwd: string): Promise<{ diff: string; changedFiles: string[] }> {
  const result = await execFileNoThrowWithCwd(
    'git',
    ['diff', 'HEAD', '--stat'],
    { cwd, preserveOutputOnError: true },
  )
  const statLines = result.stdout.trim().split('\n').filter(Boolean)
  const changedFiles = statLines
    .slice(0, -1) // last line is summary
    .map(line => line.split('|')[0]?.trim())
    .filter(Boolean)

  const diffResult = await execFileNoThrowWithCwd(
    'git',
    ['diff', 'HEAD'],
    { cwd, preserveOutputOnError: true },
  )
  const diff = diffResult.stdout.slice(0, MAX_DIFF_CHARS)
  return { diff, changedFiles }
}

export function buildVerifierPrompt(evidence: SpecVerifyEvidence): string {
  const incompleteTasks = evidence.tasks.filter(t => !t.done).map(t => `- ${t.id}: ${t.title}`).join('\n') || 'None (all tasks marked done)'
  const prior = evidence.priorVerifications
    .map(r => `- ${r.generatedAt}: ${r.verdict} — ${r.summary}`)
    .join('\n') || 'No prior verifications.'

  return [
    'You are verifying the implementation of a specced feature.',
    '',
    '=== CRITICAL ===',
    'You are STRICTLY PROHIBITED from modifying the project. Read, run commands, and inspect only.',
    'You must be stricter than the implementer. No proof = no PASS.',
    '',
    '=== REQUIRED PROOFS ===',
    'Before PASS, confirm ALL of the following with command-run evidence:',
    '1. Compile proof: the project builds (e.g., tsc --noEmit, build script).',
    '2. Test proof: the relevant test suite passes.',
    '3. Lint proof: configured linters/type-checkers pass.',
    '4. Diff proof: the changed files match the spec and do not include unrelated edits.',
    '5. Runtime proof: the feature behaves as required (run the code / hit the endpoint / exercise the CLI).',
    '',
    '=== SPEC ===',
    `Goal: ${evidence.spec.goal}`,
    '',
    'Requirements:',
    evidence.requirements || '(none written)',
    '',
    'Design:',
    evidence.design || '(none written)',
    '',
    'Tasks:',
    evidence.tasks.map(t => `- [${t.done ? 'x' : ' '}] ${t.id}: ${t.title}`).join('\n'),
    '',
    'Incomplete tasks at time of verification:',
    incompleteTasks,
    '',
    'Changed files:',
    evidence.changedFiles.length ? evidence.changedFiles.map(f => `- ${f}`).join('\n') : '(none detected)',
    '',
    'Diff preview:',
    '```diff',
    evidence.diff || '(no diff)',
    '```',
    '',
    'Prior verifications:',
    prior,
    '',
    '=== OUTPUT FORMAT ===',
    'Each check MUST include the exact command you ran and the observed output.',
    'End with exactly one line: VERDICT: PASS, VERDICT: FAIL, or VERDICT: PARTIAL.',
    'Use PARTIAL only for missing tools or environment, never for uncertainty.',
  ].join('\n')
}

async function runDeterministicGates(cwd: string): Promise<{ results: GateResult[]; failed: boolean }> {
  const config = await loadVerifyConfig(cwd)
  const results: GateResult[] = []
  if (!config) return { results, failed: false }

  const commands = config.afterEdit?.length ? config.afterEdit : []
  if (commands.length === 0) return { results, failed: false }

  const gate = await runGateCommands(commands, cwd, config.timeoutMs)
  if (gate.ok) {
    results.push({ ok: true, command: commands.join(' && '), ranCommands: gate.ranCommands })
    return { results, failed: false }
  }
  const failed = gate as Extract<typeof gate, { ok: false }>
  results.push({
    ok: false,
    command: failed.command,
    exitCode: failed.exitCode,
    stdout: failed.stdout,
    stderr: failed.stderr,
  })
  return { results, failed: true }
}

export async function runSpecVerification(
  cwd: string,
  name: string,
  options: SpecVerifyOptions = {},
): Promise<SpecVerifyResult> {
  // Kernel path: orchestrate through AgentKernel.
  if (options.kernel) {
    const { runSpecVerifyWithKernel } = await import('./kernelSpec.js')
    return runSpecVerifyWithKernel(cwd, name, options.kernel, {
      dryRun: options.dryRun,
      maxTurns: options.maxTurns,
      skipPermissions: options.skipPermissions,
      runner: options.runner,
    })
  }

  const runner = options.runner ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())

  const { readPhase, loadSpec, parseTasks } = await import('./spec.js')
  const spec = loadSpec(cwd, name)
  if (!spec) throw new Error(`Spec not found: ${name}`)

  // 1. Deterministic gates first.
  const gateRun = options.dryRun ? { results: [] as GateResult[], failed: false } : await runDeterministicGates(cwd)
  if (gateRun.failed) {
    const generatedAt = new Date().toISOString()
    const summary = `Verification failed at project gates: ${gateRun.results.filter(r => !r.ok).map(r => r.command).join(', ')}`
    const result: SpecVerifyResult = {
      verdict: 'FAIL',
      summary,
      commandFailures: gateRun.results.filter(r => !r.ok).length,
      gateResults: gateRun.results,
      subagentOutput: '',
      generatedAt,
    }
    persistVerificationResult(cwd, name, result)
    return result
  }

  // 2. Gather evidence.
  const requirements = readPhase(cwd, name, 'requirements') ?? ''
  const design = readPhase(cwd, name, 'design') ?? ''
  const tasksMd = readPhase(cwd, name, 'tasks') ?? ''
  const tasks = parseTasks(tasksMd)
  const { diff, changedFiles } = await captureDiff(cwd)
  const priorVerifications = await listVerificationRecords(cwd, name)

  const evidence: SpecVerifyEvidence = {
    spec,
    requirements,
    design,
    tasks,
    changedFiles,
    diff,
    priorVerifications,
  }

  // 3. Deep verification subagent.
  const prompt = buildVerifierPrompt(evidence)
  const { out, evidence: executionEvidence, strict } = await runExecutionBoundVerification(runner, {
    cwd,
    prompt,
    maxTurns: options.maxTurns,
    skipPermissions: options.skipPermissions,
  })

  const verdict = options.dryRun && !out.isError ? 'PARTIAL' : strict.verdict
  const commandFailures = Math.max(
    executionEvidence.executions.filter(execution => execution.exitCode !== 0 || execution.interrupted).length,
    out.isError || strict.proofFailure ? 1 : 0,
  )
  const generatedAt = new Date().toISOString()

  const summary = options.dryRun
    ? 'Dry-run preview: no execution proofs were established.'
    : verdict === 'PASS'
      ? 'All required proofs (compile, test, lint, diff, runtime) reference successful recorded executions of the current source state.'
      : verdict === 'FAIL'
        ? 'The verifier found failing evidence. See subagent output for details.'
        : 'The verifier could not reach a definitive PASS/FAIL verdict.'

  const result: SpecVerifyResult = {
    verdict,
    summary,
    commandFailures,
    gateResults: gateRun.results,
    subagentOutput: strict.output,
    generatedAt,
    evidence: executionEvidence,
  }

  if (!options.dryRun) {
    persistVerificationResult(cwd, name, result)
  }

  return result
}
