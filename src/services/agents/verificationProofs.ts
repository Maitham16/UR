import type { Verdict } from './executor.js'
import type { VerificationEvidence, VerificationExecution } from '../verifier/executionEvidence.js'

export type VerificationProofKind = 'compile' | 'test' | 'lint' | 'diff' | 'runtime'

export type VerificationProofCheck = {
  ok: boolean
  present: VerificationProofKind[]
  missing: VerificationProofKind[]
  executionIds: Partial<Record<VerificationProofKind, string>>
}

export const REQUIRED_VERIFICATION_PROOFS: VerificationProofKind[] = [
  'compile',
  'test',
  'lint',
  'diff',
  'runtime',
]

const PROOF_PATTERNS: Record<VerificationProofKind, RegExp[]> = {
  compile: [/\bcompile proof\b/i, /\bbuild proof\b/i],
  test: [/\btest proof\b/i],
  lint: [/\blint proof\b/i],
  diff: [/\bdiff proof\b/i],
  runtime: [/\bruntime proof\b/i],
}

function proofBlocks(output: string): string[] {
  const lines = output.split('\n')
  const blocks: string[] = []
  let current: string[] = []

  for (const line of lines) {
    const startsProof = REQUIRED_VERIFICATION_PROOFS.some(kind =>
      PROOF_PATTERNS[kind].some(pattern => pattern.test(line)),
    )
    if (startsProof && current.length > 0) {
      blocks.push(current.join('\n'))
      current = []
    }
    if (startsProof || current.length > 0) {
      current.push(line)
    }
  }
  if (current.length > 0) blocks.push(current.join('\n'))
  return blocks
}

function usableExecution(execution: VerificationExecution, evidence: VerificationEvidence): boolean {
  return execution.runId === evidence.runId && execution.cwd === evidence.cwd &&
    execution.exitCode === 0 && !execution.interrupted && !execution.observationError &&
    Boolean(evidence.stateSha256) && execution.beforeStateSha256 === evidence.stateSha256 &&
    execution.afterStateSha256 === evidence.stateSha256 &&
    Number.isFinite(Date.parse(execution.startedAt)) && Number.isFinite(Date.parse(execution.finishedAt)) &&
    Date.parse(execution.finishedAt) >= Date.parse(execution.startedAt)
}

export function evaluateVerificationProofs(output: string, evidence?: VerificationEvidence): VerificationProofCheck {
  const executionIds: VerificationProofCheck['executionIds'] = {}
  if (evidence?.version === 1 && !evidence.observationError) {
    const unique = new Map(evidence.executions.map(execution => [execution.id, execution]))
    if (unique.size === evidence.executions.length) for (const kind of REQUIRED_VERIFICATION_PROOFS) {
      for (const block of proofBlocks(output)) {
        if (!PROOF_PATTERNS[kind].some(pattern => pattern.test(block))) continue
        const commands = [...block.matchAll(/`([^`\n]+)`/gu)].map(match => match[1])
        const references = [...block.matchAll(/\bexecution:([a-zA-Z0-9_-]+)/gu)].map(match => match[1])
        const execution = evidence.executions.find(item =>
          usableExecution(item, evidence) &&
          (references.length > 0 ? references.includes(item.id) : commands.includes(item.command)) &&
          (commands.length === 0 || commands.includes(item.command)))
        if (execution) { executionIds[kind] = execution.id; break }
      }
    }
  }
  const present = REQUIRED_VERIFICATION_PROOFS.filter(kind => executionIds[kind] !== undefined)
  const missing = REQUIRED_VERIFICATION_PROOFS.filter(kind => !present.includes(kind))
  return { ok: missing.length === 0, present, missing, executionIds }
}

export function enforceNoPassWithoutProof(
  verdict: Verdict,
  output: string,
  evidence?: VerificationEvidence,
  runnerIsError = false,
): { verdict: Verdict; output: string; proofCheck: VerificationProofCheck; proofFailure: boolean } {
  const proofCheck = evaluateVerificationProofs(output, evidence)
  if (!runnerIsError && (verdict !== 'PASS' || proofCheck.ok)) {
    return { verdict, output, proofCheck, proofFailure: false }
  }
  return {
    verdict: 'FAIL',
    output: [
      output,
      '',
      '[deterministic proof check]',
      runnerIsError
        ? 'VERDICT: FAIL because the verification runner failed; its prose cannot establish success.'
        : `VERDICT: FAIL because PASS was claimed without required proof bound to successful executions of the current state: ${proofCheck.missing.join(', ')}`,
      ...(evidence?.observationError ? [`Evidence unavailable: ${evidence.observationError}`] : []),
    ].join('\n'),
    proofCheck,
    proofFailure: true,
  }
}
