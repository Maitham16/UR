import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { createOpenAICompatibleClient } from '../src/services/api/openaiCompatible.js'
import { createOpenRouterClient } from '../src/services/api/openrouter.js'
import { createStandardAPIClient } from '../src/services/api/standardAPI.js'

const sampleTools = [
  {
    name: 'Edit',
    description: 'Modify a file',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['file_path', 'content'],
    },
  },
]

const toolChoice = { type: 'tool', name: 'Edit' }

function userMessages() {
  return [{ role: 'user', content: 'update the file' }]
}

function openAIToolResponse(model = 'gpt-test') {
  return {
    id: 'chatcmpl_tool',
    model,
    choices: [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'Edit',
                arguments: JSON.stringify({
                  file_path: 'src/app.ts',
                  content: 'updated',
                }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  }
}

function assertOpenAIToolPayload(body: any) {
  expect(body.tools).toHaveLength(1)
  expect(body.tools[0]).toEqual({
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Modify a file',
      parameters: sampleTools[0].input_schema,
    },
  })
  expect(body.tool_choice).toEqual({
    type: 'function',
    function: { name: 'Edit' },
  })
}

function assertToolUseResponse(res: any) {
  expect(res.stop_reason).toBe('tool_use')
  expect(res.content).toHaveLength(1)
  expect(res.content[0]).toEqual({
    type: 'tool_use',
    id: 'call_1',
    name: 'Edit',
    input: {
      file_path: 'src/app.ts',
      content: 'updated',
    },
  })
}

describe('provider tool-call request and response mapping', () => {
  afterEach(() => {
    if ((axios.post as any).mockRestore) (axios.post as any).mockRestore()
  })

  test('standard OpenAI preserves tools/tool_choice and parses tool_calls', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAIToolResponse('gpt-5.5'),
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 1,
    })
    const res = await client.beta.messages.create({
      model: 'gpt-5.5',
      messages: userMessages(),
      max_tokens: 32,
      tools: sampleTools,
      tool_choice: toolChoice,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    assertOpenAIToolPayload(body)
    assertToolUseResponse(res)
  })

  test('openai-compatible preserves tools/tool_choice and parses tool_calls', async () => {
    const original = globalThis.fetch
    const seen: any[] = []
    globalThis.fetch = (async (_url: string, init: any) => {
      seen.push(JSON.parse(init.body))
      return new Response(JSON.stringify(openAIToolResponse('local-model')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const client = await createOpenAICompatibleClient({
        baseUrl: 'http://localhost:1234/v1',
        maxRetries: 1,
      })
      const res = await client.beta.messages.create({
        model: 'local-model',
        messages: userMessages(),
        max_tokens: 16,
        tools: sampleTools,
        tool_choice: toolChoice,
      })

      assertOpenAIToolPayload(seen[0])
      assertToolUseResponse(res)
    } finally {
      globalThis.fetch = original
    }
  })

  test('OpenRouter preserves system, tools/tool_choice, OpenAI messages, and parses tool_calls', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAIToolResponse('openai/gpt-5.5'),
      headers: {},
    })
    const client = await createOpenRouterClient({
      apiKey: 'sk-or',
      maxRetries: 1,
    })
    const res = await client.beta.messages.create({
      model: 'openai/gpt-5.5',
      system: 'be precise',
      messages: userMessages(),
      max_tokens: 32,
      tools: sampleTools,
      tool_choice: toolChoice,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be precise' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'update the file' })
    assertOpenAIToolPayload(body)
    assertToolUseResponse(res)
  })

  test('standard Anthropic preserves tools/tool_choice and parses tool_use blocks', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        id: 'msg_tool',
        model: 'claude-sonnet-5',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Edit',
            input: { file_path: 'src/app.ts', content: 'updated' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 3, output_tokens: 4 },
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'anthropic-api',
      apiKey: 'sk-ant-test',
      maxRetries: 1,
    })
    const res = await client.beta.messages.create({
      model: 'claude-sonnet-5',
      messages: userMessages(),
      max_tokens: 32,
      tools: sampleTools,
      tool_choice: toolChoice,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.tools).toEqual(sampleTools)
    expect(body.tool_choice).toEqual(toolChoice)
    expect(res.stop_reason).toBe('tool_use')
    expect(res.content[0]).toEqual({
      type: 'tool_use',
      id: 'toolu_1',
      name: 'Edit',
      input: { file_path: 'src/app.ts', content: 'updated' },
    })
  })

  test('standard Gemini maps tools to functionDeclarations and parses functionCall parts', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'Edit',
                    args: { file_path: 'src/app.ts', content: 'updated' },
                  },
                },
              ],
            },
            finishReason: 'FUNCTION_CALL',
          },
        ],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'gemini-api',
      apiKey: 'gm-key',
      maxRetries: 1,
    })
    const res = await client.beta.messages.create({
      model: 'gemini-3.5-flash',
      messages: userMessages(),
      max_tokens: 32,
      tools: sampleTools,
      tool_choice: toolChoice,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'Edit',
            description: 'Modify a file',
            parameters: sampleTools[0].input_schema,
          },
        ],
      },
    ])
    expect(body.toolConfig).toEqual({
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: ['Edit'],
      },
    })
    expect(res.stop_reason).toBe('tool_use')
    expect(res.content[0]).toMatchObject({
      type: 'tool_use',
      name: 'Edit',
      input: { file_path: 'src/app.ts', content: 'updated' },
    })
    expect(typeof res.content[0].id).toBe('string')
    expect(res.content[0].id.length).toBeGreaterThan(0)
  })

  test('OpenAI-family adapters fail explicitly on malformed tool_calls', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        id: 'chatcmpl_bad_tool',
        model: 'gpt-5.5',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_bad',
                  type: 'function',
                  function: { arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 1,
    })

    try {
      await client.beta.messages.create({
        model: 'gpt-5.5',
        messages: userMessages(),
        max_tokens: 32,
        tools: sampleTools,
      })
      throw new Error('expected malformed provider tool call to throw')
    } catch (error) {
      expect((error as Error).name).toBe('ProviderResponseParseError')
      expect((error as Error).message).toContain('tool_calls')
    }
  })
})
