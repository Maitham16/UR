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

test('teammate model resolver preserves explicit Ollama model IDs', () => {
  expect(parseUserSpecifiedModel('qwen3-coder:480b-cloud')).toBe(
    'qwen3-coder:480b-cloud',
  )
  expect(resolveTeammateModel('qwen3-coder:480b-cloud', null)).toBe(
    'qwen3-coder:480b-cloud',
  )
  expect(resolveTeammateModel('inherit', 'parent-model')).toBe('parent-model')
})
