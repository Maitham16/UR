import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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
