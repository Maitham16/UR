import { expect, test } from 'bun:test'
import { getWriteToolDescription } from '../src/tools/FileWriteTool/prompt.ts'

test('Write guidance requires path and complete content in one tool call', () => {
  const prompt = getWriteToolDescription()
  expect(prompt).toContain(
    'both required fields in the same structured invocation',
  )
  expect(prompt).toContain(
    'the complete literal file text in `content`',
  )
  expect(prompt).toContain(
    'surrounding assistant prose is never copied into the file',
  )
})

test('Write guidance forbids false success after invalid input', () => {
  const prompt = getWriteToolDescription()
  expect(prompt).toContain(
    'not created or updated until this tool returns a success result',
  )
  expect(prompt).toContain('do not claim the write succeeded')
})

test('Write guidance distinguishes an intentional empty file', () => {
  const prompt = getWriteToolDescription()
  expect(prompt).toContain('An empty `content` string creates an empty file')
  expect(prompt).toContain('only when an empty file is genuinely intended')
})
