import { afterEach, expect, test } from 'bun:test'
import { buildAPIRequest } from '../src/services/api/standardAPI.js'
import { toOpenAICompatibleRequest } from '../src/services/api/openaiCompatible.js'
import { createProviderClient } from '../src/services/api/providerClient.js'
import {
  cacheProviderModelsForProvider,
  clearProviderModelCacheForTests,
} from '../src/services/providers/providerRegistry.js'

afterEach(() => clearProviderModelCacheForTests())

test('direct OpenAI token limits do not depend on a curated reasoning contract', () => {
  for (const model of ['gpt-6.1-terra', 'gpt-future-model', 'gpt-4o', 'o3']) {
    const body = buildAPIRequest('openai', {
      model,
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 256,
    }, 'openai-api')
    expect(body.model).toBe(model)
    expect(body.max_completion_tokens).toBe(256)
    expect(body).not.toHaveProperty('max_tokens')
  }
})

test('live reasoning opt-outs cannot revert OpenAI to the deprecated token field', () => {
  cacheProviderModelsForProvider('openai-api', [{
    id: 'gpt-6.1-terra', displayName: 'Terra', description: '',
    reasoning: { supportsThinking: false },
  }])
  const body = buildAPIRequest('openai', {
    model: 'gpt-6.1-terra', messages: [], max_tokens: 128, stream: true,
  }, 'openai-api')
  expect(body.max_completion_tokens).toBe(128)
  expect(body).not.toHaveProperty('max_tokens')
})

test('omitted limits stay omitted and compatible servers retain their token field', () => {
  const body = buildAPIRequest('openai', { model: 'gpt-6.1-terra', messages: [] }, 'openai-api')
  expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('max_completion_tokens')
  expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('max_tokens')
  const compatible = toOpenAICompatibleRequest({ model: 'local-model', messages: [], max_tokens: 128 })
  expect(compatible.max_tokens).toBe(128)
  expect(compatible).not.toHaveProperty('max_completion_tokens')
})

test('Terra dispatches tool calls and their continuation through Responses automatically', async () => {
  const requests: any[] = []
  const model = 'gpt-6.1-terra'
  const client = await createProviderClient('openai-api', {
    model,
    apiKey: 'fixture-key',
    settings: { provider: { active: 'openai-api', model, baseUrls: { 'openai-api': 'https://fixture.invalid/v1' } } },
    fetchOverride: async (url, init) => {
      if (String(url).endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: model }] }), { headers: { 'Content-Type': 'application/json' } })
      }
      expect(String(url)).toBe('https://fixture.invalid/v1/responses')
      const body = JSON.parse(String(init?.body))
      requests.push(body)
      expect(body.model).toBe(model)
      expect(body.max_output_tokens).toBe(256)
      expect(body).not.toHaveProperty('max_tokens')
      expect(body).not.toHaveProperty('max_completion_tokens')
      return new Response(JSON.stringify({
        id: `resp_${requests.length}`, object: 'response', status: 'completed', model,
        output: requests.length === 1
          ? [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Edit', arguments: '{"path":"game.html"}' }]
          : [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Created game.html.', annotations: [] }] }],
        usage: { input_tokens: 5, output_tokens: 3 },
      }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  const messages: any[] = [{ role: 'user', content: 'Create a game in game.html.' }]
  const params = { model, messages, max_tokens: 256, tools: [{
    name: 'Edit', description: 'Edit a file',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  }] }
  const first: any = await client.beta.messages.create(params)
  expect(first.stop_reason).toBe('tool_use')
  expect(first.content).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'Edit', input: { path: 'game.html' } })
  messages.push({ role: 'assistant', content: first.content }, {
    role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'File saved.' }],
  })
  const second: any = await client.beta.messages.create({ ...params, messages })
  expect(second.content).toContainEqual({ type: 'text', text: 'Created game.html.' })
  expect(requests).toHaveLength(2)
  expect(requests[0].tools[0]).toMatchObject({ type: 'function', name: 'Edit' })
  expect(requests[1].input.find((item: any) => item.type === 'function_call_output')).toMatchObject({ call_id: 'call_1', output: 'File saved.' })
})
