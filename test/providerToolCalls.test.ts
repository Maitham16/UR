import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import {
  createOpenAICompatibleClient,
  toOpenAITools,
} from '../src/services/api/openaiCompatible.js'
import { createOpenRouterClient } from '../src/services/api/openrouter.js'
import { createStandardAPIClient } from '../src/services/api/standardAPI.js'
import { AskUserQuestionTool } from '../src/tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { zodToJsonSchema } from '../src/utils/zodToJsonSchema.js'

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
      additionalProperties: false,
    },
    strict: true,
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
      strict: true,
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

  test('OpenAI function-shaped tools retain an explicit strict contract', () => {
    expect(toOpenAITools([
      {
        type: 'function',
        function: {
          name: 'Inspect',
          description: 'Inspect a path',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    ])).toEqual([
      {
        type: 'function',
        function: {
          name: 'Inspect',
          description: 'Inspect a path',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    ])
  })

  test('internal optional tools remain available by downgrading only strict mode', () => {
    expect(toOpenAITools([
      {
        name: 'OptionalInspect',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            limit: { type: 'integer' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        strict: true,
      },
    ])).toEqual([
      {
        type: 'function',
        function: {
          name: 'OptionalInspect',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              limit: { type: 'integer' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
    ])
  })

  test('duplicate tool definitions fail clearly instead of disappearing', () => {
    expect(() => toOpenAITools([
      { name: 'Same', input_schema: { type: 'object', properties: {} } },
      { name: 'Same', input_schema: { type: 'object', properties: {} } },
    ])).toThrow(/duplicate name "Same"/)
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
    }) as unknown as typeof fetch
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
    expect(body.tools).toEqual([
      {
        name: 'Edit',
        description: 'Modify a file',
        input_schema: sampleTools[0].input_schema,
        strict: true,
      },
    ])
    expect(body.tool_choice).toEqual(toolChoice)
    expect(res.stop_reason).toBe('tool_use')
    expect(res.content[0]).toEqual({
      type: 'tool_use',
      id: 'toolu_1',
      name: 'Edit',
      input: { file_path: 'src/app.ts', content: 'updated' },
    })
  })

  test('standard Gemini round-trips function IDs and thought signatures', async () => {
    const post = spyOn(axios, 'post')
      .mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'gemini-call-1',
                    name: 'Edit',
                    args: { file_path: 'src/app.ts', content: 'updated' },
                  },
                  thoughtSignature: 'opaque-gemini-signature',
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
      .mockResolvedValueOnce({
        data: {
          candidates: [
            {
              content: { parts: [{ text: 'Done' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
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
            parametersJsonSchema: sampleTools[0].input_schema,
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
    expect(res.content[0]).toEqual({
      type: 'tool_use',
      id: 'gemini-call-1',
      name: 'Edit',
      input: { file_path: 'src/app.ts', content: 'updated' },
      gemini_thought_signature: 'opaque-gemini-signature',
    })

    await client.beta.messages.create({
      model: 'gemini-3.5-flash',
      messages: [
        ...userMessages(),
        { role: 'assistant', content: res.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'gemini-call-1',
              content: 'file updated',
            },
          ],
        },
      ],
      max_tokens: 32,
      tools: sampleTools,
    })

    const [, followUpBody] = post.mock.calls[1] as [string, Record<string, any>]
    expect(followUpBody.contents[1]).toEqual({
      role: 'model',
      parts: [
        {
          functionCall: {
            id: 'gemini-call-1',
            name: 'Edit',
            args: { file_path: 'src/app.ts', content: 'updated' },
          },
          thoughtSignature: 'opaque-gemini-signature',
        },
      ],
    })
    expect(followUpBody.contents[2]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'gemini-call-1',
            name: 'Edit',
            response: { result: 'file updated' },
          },
        },
      ],
    })
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

  test('malformed tool schemas fail before an adapter sends or retries', async () => {
    const original = globalThis.fetch
    let requests = 0
    globalThis.fetch = (async () => {
      requests++
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    try {
      const client = await createOpenAICompatibleClient({
        baseUrl: 'http://localhost:1234/v1',
        maxRetries: 3,
      })
      await expect(
        client.beta.messages.create({
          model: 'local-model',
          messages: userMessages(),
          max_tokens: 16,
          tools: [{
            name: 'BrokenTool',
            input_schema: {
              type: 'object',
              properties: { values: { type: 'array' } },
            },
          }],
        }),
      ).rejects.toThrow(/BrokenTool[\s\S]*items/)
      expect(requests).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })

  test('Gemini request preserves the actual AskUserQuestion nested schema path', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        candidates: [{ content: { parts: [{ text: 'ask' }] }, finishReason: 'STOP' }],
        usageMetadata: {},
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'gemini-api',
      apiKey: 'gm-key',
      maxRetries: 1,
    })
    await client.beta.messages.create({
      model: 'gemini-3.5-flash',
      messages: userMessages(),
      max_tokens: 32,
      tools: [{
        name: 'AskUserQuestion',
        description: 'Ask the user',
        input_schema: zodToJsonSchema(AskUserQuestionTool.inputSchema),
      }],
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    const schema = body.tools[0].functionDeclarations[0].parametersJsonSchema
    const question = schema.properties.questions.items
    expect(question.required).toEqual(expect.arrayContaining(['question', 'options']))
    expect(question.properties.question.type).toBe('string')
    expect(question.properties.options.type).toBe('array')
    expect(question.properties.options.items.required).toEqual(
      expect.arrayContaining(['label', 'description']),
    )
  })

  test('OpenAI-family adapters reject duplicate tool call IDs', async () => {
    const duplicate = openAIToolResponse('gpt-5.5')
    duplicate.choices[0]!.message.tool_calls.push({
      ...duplicate.choices[0]!.message.tool_calls[0]!,
      function: {
        name: 'Edit',
        arguments: JSON.stringify({
          file_path: 'src/other.ts',
          content: 'other',
        }),
      },
    })
    spyOn(axios, 'post').mockResolvedValue({ data: duplicate, headers: {} })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 1,
    })

    await expect(
      client.beta.messages.create({
        model: 'gpt-5.5',
        messages: userMessages(),
        max_tokens: 32,
        tools: sampleTools,
      }),
    ).rejects.toThrow('duplicate tool call id')
  })

  test('Anthropic rejects duplicate tool_use IDs at the provider boundary', async () => {
    spyOn(axios, 'post').mockResolvedValue({
      data: {
        id: 'msg_duplicate',
        model: 'claude-test',
        content: [
          { type: 'tool_use', id: 'same', name: 'Edit', input: {} },
          { type: 'tool_use', id: 'same', name: 'Edit', input: {} },
        ],
        stop_reason: 'tool_use',
        usage: {},
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'anthropic-api',
      apiKey: 'sk-ant',
      maxRetries: 1,
    })
    await expect(
      client.beta.messages.create({
        model: 'claude-test',
        messages: userMessages(),
        max_tokens: 32,
        tools: sampleTools,
      }),
    ).rejects.toThrow('duplicate tool call id')
  })

  test('Gemini rejects non-object functionCall args', async () => {
    spyOn(axios, 'post').mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'same',
                    name: 'Edit',
                    args: { file_path: 'a' },
                  },
                },
                {
                  functionCall: {
                    id: 'same',
                    name: 'Edit',
                    args: ['not-an-object'],
                  },
                },
              ],
            },
            finishReason: 'FUNCTION_CALL',
          },
        ],
        usageMetadata: {},
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'gemini-api',
      apiKey: 'gemini-key',
      maxRetries: 1,
    })
    await expect(
      client.beta.messages.create({
        model: 'gemini-test',
        messages: userMessages(),
        max_tokens: 32,
        tools: sampleTools,
      }),
    ).rejects.toThrow('JSON object')
  })

  test('Gemini rejects duplicate functionCall IDs', async () => {
    spyOn(axios, 'post').mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'same',
                    name: 'Edit',
                    args: { file_path: 'a' },
                  },
                },
                {
                  functionCall: {
                    id: 'same',
                    name: 'Edit',
                    args: { file_path: 'b' },
                  },
                },
              ],
            },
            finishReason: 'FUNCTION_CALL',
          },
        ],
        usageMetadata: {},
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'gemini-api',
      apiKey: 'gemini-key',
      maxRetries: 1,
    })
    await expect(
      client.beta.messages.create({
        model: 'gemini-test',
        messages: userMessages(),
        max_tokens: 32,
        tools: sampleTools,
      }),
    ).rejects.toThrow('duplicate tool call id')
  })
})
