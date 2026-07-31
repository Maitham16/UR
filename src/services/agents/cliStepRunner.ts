import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import type { StepRunInput, StepRunOutput, StepRunner, Verdict } from './executor.js'

/**
 * Step runners for the workflow executor.
 *
 * - makeCliStepRunner spawns a real headless `ur -p` subagent per step
 *   (same mechanism the A2A sidecar uses), resolves prompt placeholders from
 *   upstream outputs, injects reviewer feedback, and parses the verdict.
 * - makeDryRunner runs no model: it returns the compiled prompt and a PASS
 *   verdict so a workflow can be previewed (and the engine exercised) offline.
 */

const VERDICT_RE = /\bVERDICT:\s*(PASS|FAIL|PARTIAL)\b/i

export function extractVerdict(text: string): Verdict | null {
  const match = VERDICT_RE.exec(text)
  return match ? (match[1].toUpperCase() as Verdict) : null
}

/** Resolve {{depId}} / {{prior}} placeholders and append reviewer feedback. */
export function compileStepPrompt(input: StepRunInput): string {
  let prompt = input.step.prompt
  for (const [depId, output] of Object.entries(input.priorOutputs)) {
    prompt = prompt.replaceAll(`{{${depId}}}`, output)
  }
  const joinedPrior = Object.values(input.priorOutputs).join('\n\n')
  prompt = prompt.replaceAll('{{prior}}', joinedPrior)
  // Drop any unresolved placeholders so they don't leak into the prompt.
  prompt = prompt.replace(/\{\{[a-z0-9_-]+\}\}/gi, '').trim()
  if (input.feedback) {
    prompt += `\n\nReviewer feedback from the previous iteration — address it directly:\n${input.feedback}`
  }
  return prompt
}

/** Best-effort extraction of the final text from `ur -p --output-format json`. */
export function parseHeadlessOutput(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return pickResultText(parsed) ?? trimmed
  } catch {
    // stream-json or plain text — return as-is.
    return trimmed
  }
}

function pickResultText(parsed: unknown): string | null {
  if (parsed == null) return null
  if (typeof parsed === 'string') return parsed
  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1; i >= 0; i--) {
      const found = pickResultText(parsed[i])
      if (found) return found
    }
    return null
  }
  if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (typeof obj.result === 'string') return obj.result
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.content === 'string') return obj.content
  }
  return null
}

export type CliStepRunnerOptions = {
  cwd: string
  maxTurns?: number
  timeoutMs?: number
  skipPermissions?: boolean
  /** Override the `ur` entry. Defaults to re-invoking this process's CLI. */
  bin?: { file: string; baseArgs: string[] }
}

export function makeCliStepRunner(options: CliStepRunnerOptions): StepRunner {
  return async (input: StepRunInput): Promise<StepRunOutput> => {
    const prompt = compileStepPrompt(input)
    const file = options.bin?.file ?? process.execPath
    const baseArgs = options.bin?.baseArgs ?? [process.argv[1] ?? '']
    const args = [...baseArgs, '-p', '--output-format', 'json']
    if (options.maxTurns && options.maxTurns > 0) {
      args.push('--max-turns', String(options.maxTurns))
    }
    if (options.skipPermissions) {
      args.push('--dangerously-skip-permissions')
    }
    args.push(prompt)

    const result = await execFileNoThrowWithCwd(file, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 30 * 60 * 1000,
      preserveOutputOnError: true,
    })
    const output = parseHeadlessOutput(result.stdout) || result.stderr || result.error || ''
    return {
      output,
      verdict: extractVerdict(output),
      isError: result.code !== 0,
    }
  }
}

export function makeDryRunner(): StepRunner {
  return async (input: StepRunInput): Promise<StepRunOutput> => {
    const prompt = compileStepPrompt(input)
    return {
      output: `[dry-run] ${input.step.agent} would run:\n${prompt}`,
      // PASS so verification gates clear and the happy path completes offline.
      verdict: input.step.gate === 'verification' ? 'PASS' : null,
      isError: false,
    }
  }
}
