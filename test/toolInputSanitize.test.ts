import { expect, test } from 'bun:test'
import { stripEmptyParameterNames } from '../src/utils/toolInputSanitize.ts'

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
