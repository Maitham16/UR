import { describe, expect, test } from 'bun:test'
import type { SelectionSnapshot } from '../context/ideContext.js'
import {
  buildExplainPrompt,
  buildFixPrompt,
  buildGenerateTestsPrompt,
  buildRunSpecPrompt,
  buildRunWorkflowPrompt,
} from './prompts.js'

const selection: SelectionSnapshot = {
  path: 'src/foo.ts',
  languageId: 'typescript',
  startLine: 3,
  endLine: 9,
  text: 'function add(a, b) { return a + b }',
}

describe('editor action prompts', () => {
  test('explain prompt attaches the selection and asks for an explanation', () => {
    const prompt = buildExplainPrompt(selection)
    expect(prompt).toContain('@src/foo.ts:3-9')
    expect(prompt).toContain('function add(a, b)')
    expect(prompt.toLowerCase()).toContain('explain')
  })

  test('fix prompt attaches the selection and asks for a fix', () => {
    const prompt = buildFixPrompt(selection)
    expect(prompt).toContain('@src/foo.ts:3-9')
    expect(prompt.toLowerCase()).toContain('fix')
  })

  test('generate tests prompt attaches the selection and asks for tests', () => {
    const prompt = buildGenerateTestsPrompt(selection)
    expect(prompt).toContain('@src/foo.ts:3-9')
    expect(prompt.toLowerCase()).toContain('test')
  })

  test('each prompt embeds the selected text inside a fenced code block', () => {
    for (const prompt of [buildExplainPrompt(selection), buildFixPrompt(selection), buildGenerateTestsPrompt(selection)]) {
      expect(prompt).toContain('```typescript\nfunction add(a, b) { return a + b }\n```')
    }
  })
})

describe('spec/workflow prompts', () => {
  test('run spec prompt references the real ur spec CLI surface', () => {
    const prompt = buildRunSpecPrompt()
    expect(prompt).toContain('ur spec list')
    expect(prompt).toContain('ur spec init')
  })

  test('run workflow prompt references the real ur workflow CLI surface', () => {
    const prompt = buildRunWorkflowPrompt()
    expect(prompt).toContain('ur workflow list')
  })
})
