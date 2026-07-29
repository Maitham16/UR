import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse, type ParseError } from 'jsonc-parser'
import { SettingsSchema } from '../src/utils/settings/types.ts'

// docsCommands.test.ts enforces that every command is documented, but nothing
// enforced the same for settings — which is how several releases shipped
// settings that existed in the schema and appeared in no document, leaving
// them undiscoverable except by reading types.ts.

const DOC = 'technical/06-configuration.md'

function settingsKeys(): string[] {
  const schema = SettingsSchema() as unknown as {
    shape?: Record<string, unknown>
    _def?: { shape?: () => Record<string, unknown> }
  }
  const shape = schema.shape ?? schema._def?.shape?.()
  return Object.keys(shape ?? {})
}

test('every settings key appears in the configuration doc', () => {
  const doc = readFileSync(DOC, 'utf8')
  const missing = settingsKeys().filter(key => !doc.includes(key))
  // Naming them makes the failure actionable rather than a bare count.
  expect(missing).toEqual([])
})

test('the schema is actually being read, so the check can fail', () => {
  // A coverage test that silently reads zero keys passes forever. This is the
  // guard against the guard.
  const keys = settingsKeys()
  expect(keys.length).toBeGreaterThan(50)
  expect(keys).toContain('permissions')
})

test('every settings JSONC example parses and all shipped keys have valid values', () => {
  const doc = readFileSync(DOC, 'utf8')
  const examples = [...doc.matchAll(/```jsonc\n([\s\S]*?)```/g)].map(
    match => match[1]!,
  )
  expect(examples.length).toBeGreaterThan(5)

  for (const [index, source] of examples.entries()) {
    const errors: ParseError[] = []
    const value = parse(source, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    })
    expect(errors, `JSONC example ${index + 1} must parse`).toEqual([])
    const result = SettingsSchema().safeParse(value)
    expect(
      result.success,
      `JSONC example ${index + 1}: ${
        result.success ? '' : JSON.stringify(result.error.issues)
      }`,
    ).toBe(true)
  }
})
