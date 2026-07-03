import { describe, expect, test } from 'bun:test'
import { buildVerifierPrompt } from './verifierPrompt.js'

describe('buildVerifierPrompt', () => {
  test('asks for the real verification subagent, not an invented mechanism', () => {
    const prompt = buildVerifierPrompt()
    expect(prompt).toContain('subagent_type="verification"')
  })

  test('requires a verdict to be reported verbatim rather than assumed', () => {
    const prompt = buildVerifierPrompt()
    expect(prompt).toContain('VERDICT')
    expect(prompt.toLowerCase()).toContain('report it verbatim')
  })

  test('explicitly forbids declaring completion without a PASS verdict (no fake success)', () => {
    const prompt = buildVerifierPrompt()
    expect(prompt).toContain('Do not declare the task complete unless the verdict is PASS.')
  })
})
