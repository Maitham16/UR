import { expect, test } from 'bun:test'
import {
  mergeToolCalls,
  type OllamaToolCall,
} from '../src/services/api/ollama.js'
import { parseToolInputJsonLenient } from '../src/utils/json.js'

// --- mergeToolCalls: Ollama streams each completed tool call in its own
// chunk as a single-element array. The old positional merge collapsed
// multi-call turns into just the last call.

test('mergeToolCalls keeps multiple calls streamed in separate chunks', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a/__init__.py', content: '' } } },
  ])
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a/test_x.py', content: 'def test(): pass' } } },
  ])
  mergeToolCalls(target, [
    { function: { name: 'Bash', arguments: { command: 'pytest' } } },
  ])
  expect(target).toHaveLength(3)
  expect(target[0]?.function?.name).toBe('Write')
  expect((target[0]?.function?.arguments as Record<string, unknown>).file_path).toBe('/a/__init__.py')
  expect((target[1]?.function?.arguments as Record<string, unknown>).file_path).toBe('/a/test_x.py')
  expect(target[2]?.function?.name).toBe('Bash')
})

test('mergeToolCalls does not clobber good arguments with a later empty resend', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a.py', content: 'x = 1' } } },
  ])
  mergeToolCalls(target, [{ function: { name: 'Write', arguments: {} } }])
  expect(target).toHaveLength(1)
  expect((target[0]?.function?.arguments as Record<string, unknown>).content).toBe('x = 1')
})

test('mergeToolCalls concatenates string argument fragments for the same call', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: '{"file_pa' } },
  ])
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: 'th": "/a.py", "content": "hi"}' } },
  ])
  expect(target).toHaveLength(1)
  expect(target[0]?.function?.arguments).toBe(
    '{"file_path": "/a.py", "content": "hi"}',
  )
})

test('mergeToolCalls treats nameless entries as fragments of the last call', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [{ function: { name: 'Bash', arguments: '{"comm' } }])
  mergeToolCalls(target, [{ function: { arguments: 'and": "ls"}' } }])
  expect(target).toHaveLength(1)
  expect(target[0]?.function?.arguments).toBe('{"command": "ls"}')
})

test('mergeToolCalls is idempotent for cumulative-style resends', () => {
  const call: OllamaToolCall = {
    function: { name: 'Read', arguments: { file_path: '/a.py' } },
  }
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [call])
  mergeToolCalls(target, [call])
  expect(target).toHaveLength(1)
})

test('mergeToolCalls merges object fragments shallowly', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a.py' } } },
  ])
  mergeToolCalls(target, [{ function: { arguments: { content: 'x' } } }])
  expect(target).toHaveLength(1)
  expect(target[0]?.function?.arguments).toEqual({
    file_path: '/a.py',
    content: 'x',
  })
})

// --- parseToolInputJsonLenient: repairs the almost-JSON local models emit.

test('lenient parser accepts strict JSON unchanged', () => {
  expect(parseToolInputJsonLenient('{"a": 1}')).toEqual({ a: 1 })
})

test('lenient parser repairs raw newlines inside string values', () => {
  const raw = '{"file_path": "/a.py", "content": "line1\nline2\n"}'
  expect(parseToolInputJsonLenient(raw)).toEqual({
    file_path: '/a.py',
    content: 'line1\nline2\n',
  })
})

test('lenient parser repairs raw tabs and control chars', () => {
  const raw = '{"content": "a\tb\rc"}'
  expect(parseToolInputJsonLenient(raw)).toEqual({ content: 'a\tb\rc' })
})

test('lenient parser strips markdown fences and trailing commas', () => {
  const raw = '```json\n{"command": "ls",}\n```'
  expect(parseToolInputJsonLenient(raw)).toEqual({ command: 'ls' })
})

test('lenient parser preserves already-escaped sequences', () => {
  const raw = '{"content": "a\\nb"}'
  expect(parseToolInputJsonLenient(raw)).toEqual({ content: 'a\nb' })
})

test('lenient parser returns null for hopeless input', () => {
  expect(parseToolInputJsonLenient('not json at all')).toBeNull()
  expect(parseToolInputJsonLenient('')).toBeNull()
})

// --- Canonical arg keys: dedup must not be defeated by key order.

test('mergeToolCalls dedupes cumulative resends regardless of key order', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a.py', content: 'x' } } },
  ])
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { content: 'x', file_path: '/a.py' } } },
  ])
  expect(target).toHaveLength(1)
})
