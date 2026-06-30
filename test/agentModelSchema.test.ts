import { expect, test } from 'bun:test'
import { AgentTool } from '../src/tools/AgentTool/AgentTool.tsx'
import { resolveTeammateModel } from '../src/tools/shared/spawnMultiAgent.ts'
import { parseUserSpecifiedModel } from '../src/utils/model/model.ts'

test('AgentTool accepts alias and full provider model IDs', () => {
  expect(
    AgentTool.inputSchema.safeParse({
      description: 'Plan patch',
      prompt: 'Return a concrete patch plan.',
      model: 'modelS',
    }).success,
  ).toBe(true)

  expect(
    AgentTool.inputSchema.safeParse({
      description: 'Plan patch',
      prompt: 'Return a concrete patch plan.',
      model: 'qwen3-coder:480b-cloud',
    }).success,
  ).toBe(true)
})

test('teammate model resolver maps aliases before launching Ollama', () => {
  const previous = process.env.OLLAMA_MODEL
  process.env.OLLAMA_MODEL = 'qwen3-coder:480b-cloud'
  try {
    expect(parseUserSpecifiedModel('modelS')).toBe('qwen3-coder:480b-cloud')
    expect(parseUserSpecifiedModel('modelS[1m]')).toBe(
      'qwen3-coder:480b-cloud[1m]',
    )
    expect(resolveTeammateModel('modelS', null)).toBe('qwen3-coder:480b-cloud')
    expect(resolveTeammateModel('qwen3-coder:480b-cloud', null)).toBe(
      'qwen3-coder:480b-cloud',
    )
    expect(resolveTeammateModel('inherit', 'parent-model')).toBe('parent-model')
  } finally {
    if (previous === undefined) {
      delete process.env.OLLAMA_MODEL
    } else {
      process.env.OLLAMA_MODEL = previous
    }
  }
})
