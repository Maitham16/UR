import { resolveUrExecutable } from '../../utils/urExecutable.js'
/**
 * Single-shot headless agent runner.
 *
 * The thin counterpart to cliStepRunner: spawns one `ur -p` subagent for a raw
 * prompt and returns its parsed output and verdict. Unlike the step runner it
 * accepts a per-run model override (UR_MODEL on the child env), which the
 * escalation router, arena, spec executor, and CI loop all need. Network/exec
 * lives behind the injectable `HeadlessRunner` so callers stay unit-testable.
 */

import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { extractVerdict, parseHeadlessOutput } from './cliStepRunner.js'
import type { StepRunOutput } from './executor.js'
import { isVerificationExecution, type VerificationEvidence } from '../verifier/executionEvidence.js'

export type HeadlessRunOptions = {
  cwd: string
  prompt: string
  model?: string
  maxTurns?: number
  timeoutMs?: number
  skipPermissions?: boolean
  /** Explicit child environment. Used by isolated CI to strip platform tokens. */
  env?: NodeJS.ProcessEnv
  /** Explicit tool set; an empty array disables all tools. */
  tools?: string[]
  /** Prevent durable chat/session files for ephemeral judge/eval calls. */
  noSessionPersistence?: boolean
  bin?: { file: string; baseArgs: string[] }
  sessionId?: string
  resumeSessionId?: string
  maxBudgetUsd?: number
  signal?: AbortSignal
  onSpawn?: (pid: number) => void
  /** Collect runtime-emitted command evidence for this verification attempt. */
  verification?: { runId: string }
}

export type HeadlessRunOutput = StepRunOutput & {
  costUsd?: number
  sessionId?: string
  usage?: Record<string, unknown>
  turns?: number
  verification?: VerificationEvidence
}

export type HeadlessRunner = (options: HeadlessRunOptions) => Promise<HeadlessRunOutput>

/** Read the existing SDK envelope, never scrape command stdout as SDK events. */
export function parseHeadlessRun(stdout: string, options: Pick<HeadlessRunOptions, 'cwd' | 'verification'>): HeadlessRunOutput {
  let records: Record<string, any>[] = []
  try {
    const parsed = JSON.parse(stdout)
    records = (Array.isArray(parsed) ? parsed : [parsed]).filter(value => value && typeof value === 'object')
  } catch {
    records = stdout.split('\n').flatMap(line => {
      try { const value = JSON.parse(line); return value && typeof value === 'object' ? [value] : [] }
      catch { return [] }
    })
  }
  const result = records.findLast(record => record.type === 'result')
  const output = typeof result?.result === 'string' ? result.result : parseHeadlessOutput(stdout)
  const run: HeadlessRunOutput = {
    output, verdict: extractVerdict(output),
    isError: !result || result.is_error === true || String(result.subtype ?? '').startsWith('error'),
    ...(result?.cost_status !== 'unknown' && typeof result?.total_cost_usd === 'number' && Number.isFinite(result.total_cost_usd) && result.total_cost_usd >= 0
      ? { costUsd: result.total_cost_usd } : {}),
    ...(typeof result?.session_id === 'string' ? { sessionId: result.session_id } : {}),
    ...(result?.usage && typeof result.usage === 'object' && !Array.isArray(result.usage) ? { usage: result.usage } : {}),
    ...(Number.isInteger(result?.num_turns) && result.num_turns >= 0 ? { turns: result.num_turns } : {}),
  }
  if (options.verification) {
    const calls = new Map<string, string>()
    const verification: VerificationEvidence = {
      version: 1, runId: options.verification.runId, cwd: options.cwd, executions: [],
    }
    for (const record of records) {
      const content = record.message?.content
      if (!Array.isArray(content)) continue
      if (record.type === 'assistant') {
        for (const block of content) {
          if (block.type === 'tool_use' && ['Bash', 'PowerShell'].includes(block.name) &&
              typeof block.id === 'string' && typeof block.input?.command === 'string') {
            calls.set(block.id, block.input.command)
          }
        }
      } else if (record.type === 'user') {
        const execution = record.tool_use_result?._urVerification
        const resultBlock = content.find(block => block.type === 'tool_result' && block.tool_use_id === execution?.toolUseId)
        if (!isVerificationExecution(execution) || execution.runId !== options.verification.runId ||
            execution.id !== execution.toolUseId || calls.get(execution.toolUseId) !== execution.command ||
            !resultBlock) continue
        verification.executions.push({ ...execution, interrupted: execution.interrupted || Boolean(resultBlock.is_error) })
        calls.delete(execution.toolUseId)
      }
    }
    run.verification = verification
  }
  return run
}

export function defaultHeadlessRunner(): HeadlessRunner {
  return async (options: HeadlessRunOptions): Promise<HeadlessRunOutput> => {
    const { file, baseArgs } = options.bin ?? resolveUrExecutable()
    const args = [...baseArgs, '-p', '--output-format', options.verification ? 'stream-json' : 'json']
    if (options.verification) args.push('--verbose')
    if (options.sessionId && options.resumeSessionId) throw new Error('sessionId and resumeSessionId are mutually exclusive')
    if (options.sessionId) args.push('--session-id', options.sessionId)
    if (options.resumeSessionId) args.push('--resume', options.resumeSessionId)
    if (options.maxBudgetUsd !== undefined) {
      if (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd <= 0) throw new Error('maxBudgetUsd must be positive')
      args.push('--max-budget-usd', String(options.maxBudgetUsd))
    }
    if (options.maxTurns && options.maxTurns > 0) {
      args.push('--max-turns', String(options.maxTurns))
    }
    if (options.skipPermissions) {
      args.push('--dangerously-skip-permissions')
    }
    if (options.tools) {
      args.push('--tools', options.tools.join(','))
    }
    if (options.noSessionPersistence) {
      args.push('--no-session-persistence')
    }
    args.push(options.prompt)

    const env =
      options.env || options.model || options.verification
        ? {
            ...(options.env ?? process.env),
            ...(options.model
              ? {
                  UR_MODEL: options.model,
                  OLLAMA_MODEL: options.model,
                }
              : {}),
            ...(options.verification ? { UR_VERIFICATION_RUN_ID: options.verification.runId } : {}),
          }
        : undefined

    const result = await execFileNoThrowWithCwd(file, args, {
      cwd: options.cwd,
      abortSignal: options.signal,
      onSpawn: options.onSpawn,
      timeout: options.timeoutMs ?? 30 * 60 * 1000,
      env,
      extendEnv: options.env ? false : true,
      preserveOutputOnError: true,
      maxBuffer: 10 * 1024 * 1024,
    })
    const parsed = parseHeadlessRun(result.stdout, options)
    return {
      ...parsed,
      output: parsed.output || result.stderr || result.error || '',
      isError: parsed.isError || result.code !== 0,
    }
  }
}

export function makeDryHeadlessRunner(): HeadlessRunner {
  return async (options: HeadlessRunOptions): Promise<StepRunOutput> => ({
    output: `[dry-run] would run model=${options.model ?? 'auto'}:\n${options.prompt}`,
    verdict: 'PASS',
    isError: false,
  })
}
