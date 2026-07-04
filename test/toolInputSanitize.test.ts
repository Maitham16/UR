import { expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  stripEmptyParameterNames,
  stripUnrecognizedKeys,
} from '../src/utils/toolInputSanitize.ts'

test('strips empty-string parameter names', () => {
  const r = stripEmptyParameterNames({ command: 'ls', '': 'junk' })
  expect(r.stripped).toBe(true)
  expect(r.input).toEqual({ command: 'ls' })
})

test('leaves clean input untouched', () => {
  const input = { command: 'ls', timeout: 5000 }
  const r = stripEmptyParameterNames(input)
  expect(r.stripped).toBe(false)
  expect(r.input).toBe(input)
})

test('passes through non-objects, arrays, and null', () => {
  expect(stripEmptyParameterNames('x')).toEqual({ input: 'x', stripped: false })
  expect(stripEmptyParameterNames(null)).toEqual({ input: null, stripped: false })
  expect(stripEmptyParameterNames([1])).toEqual({ input: [1], stripped: false })
})

test('handles input that is only an empty key', () => {
  const r = stripEmptyParameterNames({ '': 'x' })
  expect(r.stripped).toBe(true)
  expect(r.input).toEqual({})
})

const writeSchema = z.strictObject({ file_path: z.string(), content: z.string() })

test('stripUnrecognizedKeys removes hallucinated extras so re-parse succeeds', () => {
  const input = { file_path: '/tmp/a.py', content: 'x', title: 't', description: 'd' }
  const first = writeSchema.safeParse(input)
  expect(first.success).toBe(false)
  const { input: cleaned, stripped } = stripUnrecognizedKeys(
    input,
    (first as { success: false; error: { issues: any[] } }).error.issues,
  )
  expect(stripped.sort()).toEqual(['description', 'title'])
  expect(cleaned).toEqual({ file_path: '/tmp/a.py', content: 'x' })
  expect(writeSchema.safeParse(cleaned).success).toBe(true)
})

test('stripUnrecognizedKeys does not mutate the original input', () => {
  const input = { file_path: '/tmp/a.py', content: 'x', title: 't' }
  const issues = (writeSchema.safeParse(input) as { error: { issues: any[] } }).error.issues
  stripUnrecognizedKeys(input, issues)
  expect(input).toHaveProperty('title')
})

test('stripUnrecognizedKeys is a no-op when there are no unrecognized keys', () => {
  const r = stripUnrecognizedKeys({ a: 1 }, [{ code: 'invalid_type', path: ['a'] }])
  expect(r.stripped).toEqual([])
  expect(r.input).toEqual({ a: 1 })
})

test('stripUnrecognizedKeys handles nested paths', () => {
  const nested = z.strictObject({ outer: z.strictObject({ ok: z.string() }) })
  const input = { outer: { ok: 'y', bogus: 1 } }
  const issues = (nested.safeParse(input) as { error: { issues: any[] } }).error.issues
  const { input: cleaned, stripped } = stripUnrecognizedKeys(input, issues)
  expect(stripped).toEqual(['bogus'])
  expect(nested.safeParse(cleaned).success).toBe(true)
})
