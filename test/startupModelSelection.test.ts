import { describe, expect, test } from 'bun:test'
import {
  settingsSelectModel,
  shouldRequireStartupModelSelection,
} from '../src/services/providers/startupModelSelection.js'

describe('startup model selection', () => {
  test('requires a choice for a new workspace without a model', () => {
    expect(shouldRequireStartupModelSelection({})).toBe(true)
    expect(
      shouldRequireStartupModelSelection({
        workspaceSettings: [{ provider: { active: 'ollama' } }],
      }),
    ).toBe(true)
  })

  test('does not treat blank model values as a selection', () => {
    expect(settingsSelectModel({ model: '  ' })).toBe(false)
    expect(
      settingsSelectModel({ provider: { active: 'ollama', model: '' } }),
    ).toBe(false)
  })

  test('accepts a folder-local or shared project model', () => {
    expect(
      shouldRequireStartupModelSelection({
        workspaceSettings: [{ model: 'qwen3-coder:latest' }],
      }),
    ).toBe(false)
    expect(
      shouldRequireStartupModelSelection({
        workspaceSettings: [
          { provider: { active: 'openai-api', model: 'gpt-5.5' } },
        ],
      }),
    ).toBe(false)
  })

  test('accepts deliberate CLI, environment, agent, and managed models', () => {
    expect(
      shouldRequireStartupModelSelection({ explicitModels: ['default'] }),
    ).toBe(false)
    expect(
      shouldRequireStartupModelSelection({
        explicitModels: [undefined, 'qwen3-coder:latest'],
      }),
    ).toBe(false)
    expect(
      shouldRequireStartupModelSelection({
        workspaceSettings: [undefined, { model: 'managed-model' }],
      }),
    ).toBe(false)
  })

  test('does not interrupt resume or initialization-only paths', () => {
    expect(shouldRequireStartupModelSelection({ isResume: true })).toBe(false)
    expect(
      shouldRequireStartupModelSelection({ skipsModelExecution: true }),
    ).toBe(false)
  })
})
