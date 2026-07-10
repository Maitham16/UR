import { Ajv } from 'ajv'
import { parseToolInputJsonLenient } from '../../utils/json.js'
import type { HeadlessRunner, HeadlessRunOptions } from './headlessAgent.js'

/**
 * Structured-output child sessions: run a headless agent that must return a
 * JSON object matching a caller-supplied JSON Schema (Devin-style playbook
 * sessions). The schema is appended to the prompt as a hard instruction, the
 * reply is parsed leniently (local models emit almost-JSON), validated with
 * ajv, and on mismatch the agent gets exactly one repair round with the
 * validation errors — the same feedback-loop shape the tool-input pipeline
 * uses. Callers always receive the raw output too, so nothing is lost when
 * validation fails.
 */

export type StructuredRunResult = {
  ok: boolean
  /** Parsed, schema-valid object when ok; best-effort parse otherwise. */
  data: unknown | null
  errors: string[]
  rawOutput: string
  attempts: number
}

function schemaInstruction(schema: object): string {
  return [
    '',
    'OUTPUT CONTRACT: End your reply with a single fenced json block containing',
    'ONE JSON object that validates against this JSON Schema (no prose inside the fence):',
    JSON.stringify(schema),
  ].join('\n')
}

/** Pull the last fenced json block, else the last {...} object in the text. */
export function extractJsonPayload(text: string): string | null {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)]
  const fenced = fences.at(-1)?.[1]?.trim()
  if (fenced) return fenced
  const start = text.lastIndexOf('{')
  if (start === -1) return null
  return text.slice(start).trim()
}

export async function runStructured(
  runner: HeadlessRunner,
  options: HeadlessRunOptions & { schema: object; repairRounds?: number },
): Promise<StructuredRunResult> {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const validate = ajv.compile(options.schema)
  const maxAttempts = 1 + (options.repairRounds ?? 1)

  let prompt = `${options.prompt}${schemaInstruction(options.schema)}`
  let raw = ''
  let lastErrors: string[] = []
  let lastParsed: unknown | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const out = await runner({ ...options, prompt })
    raw = out.output
    const payload = extractJsonPayload(out.output)
    const parsed = payload ? parseToolInputJsonLenient(payload) : null
    lastParsed = parsed
    if (parsed !== null && validate(parsed)) {
      return { ok: true, data: parsed, errors: [], rawOutput: raw, attempts: attempt }
    }
    lastErrors =
      parsed === null
        ? ['reply did not contain a parseable JSON object']
        : (validate.errors ?? []).map(
            e => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`,
          )
    prompt = [
      options.prompt,
      schemaInstruction(options.schema),
      '',
      'Your previous reply failed validation:',
      ...lastErrors.map(e => `- ${e}`),
      'Reply again with ONLY a corrected fenced json block.',
    ].join('\n')
  }

  return { ok: false, data: lastParsed, errors: lastErrors, rawOutput: raw, attempts: maxAttempts }
}
