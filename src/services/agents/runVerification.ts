import { realpath } from 'node:fs/promises'
import { extractVerdict } from './cliStepRunner.js'
import type { HeadlessRunOptions, HeadlessRunOutput, HeadlessRunner } from './headlessAgent.js'
import { captureVerificationState, isVerificationExecution, newVerificationEvidence } from '../verifier/executionEvidence.js'
import { enforceNoPassWithoutProof } from './verificationProofs.js'

/** Shared by the existing spec and kernel verifier APIs. Never chooses commands. */
export async function runExecutionBoundVerification(runner: HeadlessRunner, options: HeadlessRunOptions) {
  const evidence = newVerificationEvidence(await realpath(options.cwd))
  let initialState: string | undefined
  try { initialState = (await captureVerificationState(evidence.cwd)).sha256 }
  catch (error) { evidence.observationError = String(error) }
  let out: HeadlessRunOutput
  try {
    out = await runner({
      ...options, cwd: evidence.cwd, verification: { runId: evidence.runId },
      prompt: `${options.prompt}\n\nFor each required proof, cite the exact command in backticks or its execution:<tool_use_id>. Only completed command executions against the current source state count as evidence. Prose alone, failed/background commands, and results from earlier source revisions cannot establish PASS. Choose the commands appropriate to this project; missing evidence must be reported honestly.`,
    })
  } catch (error) {
    out = { output: `Verification runner error: ${String(error)}`, isError: true, verdict: 'FAIL' }
  }
  if (out.verification?.runId === evidence.runId && Array.isArray(out.verification.executions)) {
    evidence.executions = out.verification.executions.filter(isVerificationExecution)
  }
  try {
    evidence.stateSha256 = (await captureVerificationState(evidence.cwd)).sha256
    if (initialState !== evidence.stateSha256) evidence.observationError = 'Source state changed during read-only verification'
  } catch (error) { evidence.observationError = String(error) }
  const strict = enforceNoPassWithoutProof(
    out.verdict ?? extractVerdict(out.output) ?? 'PARTIAL', out.output, evidence, out.isError === true,
  )
  return { out, evidence, strict }
}
