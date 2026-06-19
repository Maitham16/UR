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

export type HeadlessRunOptions = {
  cwd: string
  prompt: string
  model?: string
  maxTurns?: number
  timeoutMs?: number
  skipPermissions?: boolean
  bin?: { file: string; baseArgs: string[] }
}

export type HeadlessRunner = (options: HeadlessRunOptions) => Promise<StepRunOutput>

export function defaultHeadlessRunner(): HeadlessRunner {
  return async (options: HeadlessRunOptions): Promise<StepRunOutput> => {
    const file = options.bin?.file ?? process.execPath
    const baseArgs = options.bin?.baseArgs ?? [process.argv[1] ?? '']
    const args = [...baseArgs, '-p', '--output-format', 'json']
    if (options.maxTurns && options.maxTurns > 0) {
      args.push('--max-turns', String(options.maxTurns))
    }
    if (options.skipPermissions) {
      args.push('--dangerously-skip-permissions')
    }
    args.push(options.prompt)

    const env = options.model
      ? { ...process.env, UR_MODEL: options.model, OLLAMA_MODEL: options.model }
      : undefined

    const result = await execFileNoThrowWithCwd(file, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 30 * 60 * 1000,
      env,
      preserveOutputOnError: true,
    })
    const output =
      parseHeadlessOutput(result.stdout) || result.stderr || result.error || ''
    return { output, verdict: extractVerdict(output), isError: result.code !== 0 }
  }
}

export function makeDryHeadlessRunner(): HeadlessRunner {
  return async (options: HeadlessRunOptions): Promise<StepRunOutput> => ({
    output: `[dry-run] would run model=${options.model ?? 'auto'}:\n${options.prompt}`,
    verdict: 'PASS',
    isError: false,
  })
}
