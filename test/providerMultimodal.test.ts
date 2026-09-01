import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import {
  createOpenAICompatibleClient,
  toOpenAICompatibleRequest,
} from '../src/services/api/openaiCompatible.js'
import { createOpenRouterClient } from '../src/services/api/openrouter.js'
import { createStandardAPIClient } from '../src/services/api/standardAPI.js'

const imageBlock = {
  type: 'image',
  source: {
    type: 'base64',
    media_type: 'image/png',
    data: 'iVBORw0KGgo=',
  },
}

const openAITextResponse = {
  id: 'chatcmpl_text',
  model: 'gpt-test',
  choices: [
    {
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 1 },
}

function multimodalMessages() {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'describe this image' },
        imageBlock,
      ],
    },
  ]
}

function toolHistoryMessages() {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will read it.' },
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'Read',
          input: { file_path: 'README.md' },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: [{ type: 'text', text: 'read complete' }],
        },
      ],
    },
    ...multimodalMessages(),
  ]
}

function imageToolHistoryMessages() {
  return [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call_image',
          name: 'Computer',
          input: { action: 'screenshot' },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_image',
          content: [
            { type: 'text', text: 'screenshot captured' },
            imageBlock,
          ],
        },
      ],
    },
  ]
}

function expectOpenAIImagePart(content: any) {
  expect(content).toEqual([
    { type: 'text', text: 'describe this image' },
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
    },
  ])
}

describe('provider multimodal request mapping', () => {
  afterEach(() => {
    if ((axios.post as any).mockRestore) (axios.post as any).mockRestore()
  })

  test('OpenAI text-only content keeps the existing string payload shape', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAITextResponse,
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 1,
    })

    await client.beta.messages.create({
      model: 'gpt-5.5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
          ],
        },
      ],
      max_tokens: 16,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hello\nworld' })
  })

  test('standard OpenAI preserves image blocks as OpenAI content parts', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAITextResponse,
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 1,
    })

    await client.beta.messages.create({
      model: 'gpt-5.5',
      messages: multimodalMessages(),
      max_tokens: 16,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expectOpenAIImagePart(body.messages[0].content)
  })

  test('OpenAI-compatible preserves image blocks and existing tool history mapping', async () => {
    const original = globalThis.fetch
    const seen: any[] = []
    globalThis.fetch = (async (_url: string, init: any) => {
      seen.push(JSON.parse(init.body))
      return new Response(JSON.stringify(openAITextResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const client = await createOpenAICompatibleClient({
        baseUrl: 'http://localhost:1234/v1',
        maxRetries: 1,
      })

      await client.beta.messages.create({
        model: 'local-vision-model',
        messages: toolHistoryMessages(),
        max_tokens: 16,
      })

      const messages = seen[0].messages
      expect(messages[0]).toMatchObject({
        role: 'assistant',
        content: 'I will read it.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'Read',
              arguments: JSON.stringify({ file_path: 'README.md' }),
            },
          },
        ],
      })
      expect(messages[1]).toEqual({
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'Read',
        content: 'read complete',
      })
      expectOpenAIImagePart(messages[2].content)
    } finally {
      globalThis.fetch = original
    }
  })

  test('OpenAI-family moves tool-result images to an adjacent multimodal user message', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAITextResponse,
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 1,
    })

    await client.beta.messages.create({
      model: 'gpt-5.5',
      messages: imageToolHistoryMessages(),
      max_tokens: 16,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.messages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_image',
      name: 'Computer',
      content: 'screenshot captured',
    })
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Image output from tool Computer:' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
        },
      ],
    })
  })

  test('OpenRouter preserves image blocks as OpenAI content parts', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAITextResponse,
      headers: {},
    })
    const client = await createOpenRouterClient({
      apiKey: 'sk-or',
      maxRetries: 1,
    })

    await client.beta.messages.create({
      model: 'openai/gpt-5.5',
      messages: multimodalMessages(),
      max_tokens: 16,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expectOpenAIImagePart(body.messages[0].content)
  })

  test('OpenRouter keeps tool output textual and sends its image in a user turn', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAITextResponse,
      headers: {},
    })
    const client = await createOpenRouterClient({
      apiKey: 'sk-or',
      maxRetries: 1,
    })

    await client.beta.messages.create({
      model: 'openai/gpt-5.5',
      messages: imageToolHistoryMessages(),
      max_tokens: 16,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.messages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_image',
      name: 'Computer',
      content: 'screenshot captured',
    })
    expect(body.messages[2].role).toBe('user')
    expect(body.messages[2].content[0]).toEqual({
      type: 'text',
      text: 'Image output from tool Computer:',
    })
    expectOpenAIImagePart([
      { type: 'text', text: 'describe this image' },
      body.messages[2].content[1],
    ])
  })

  test('every OpenAI-compatible provider uses the safe tool-image wire shape', () => {
    for (const providerId of [
      'openai-compatible',
      'lmstudio',
      'llama.cpp',
      'vllm',
      'unsloth',
      'nvidia-nim',
    ]) {
      const body = toOpenAICompatibleRequest(
        {
          model: 'vision-model',
          messages: imageToolHistoryMessages(),
          max_tokens: 16,
        },
        providerId,
      )
      expect(body.messages[1]).toMatchObject({
        role: 'tool',
        tool_call_id: 'call_image',
        content: 'screenshot captured',
      })
      expect(body.messages[2]).toMatchObject({
        role: 'user',
        content: [
          { type: 'text', text: 'Image output from tool Computer:' },
          { type: 'image_url' },
        ],
      })
    }
  })

  test('Anthropic preserves image blocks in message content', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        id: 'msg_text',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 1 },
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'anthropic-api',
      apiKey: 'sk-ant',
      maxRetries: 1,
    })

    await client.beta.messages.create({
      model: 'claude-sonnet-5',
      messages: multimodalMessages(),
      max_tokens: 16,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'describe this image' },
      imageBlock,
    ])
  })

  test('Anthropic preserves image blocks inside tool_result content', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        id: 'msg_text',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 1 },
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'anthropic-api',
      apiKey: 'sk-ant',
      maxRetries: 1,
    })

    await client.beta.messages.create({
      model: 'claude-sonnet-5',
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Read',
              input: { file_path: 'diagram.png' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [
                { type: 'text', text: 'image result' },
                imageBlock,
              ],
            },
          ],
        },
      ],
      max_tokens: 16,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.messages[1].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: [
        { type: 'text', text: 'image result' },
        imageBlock,
      ],
    })
  })

  test('Gemini preserves image blocks as inlineData parts', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        candidates: [
          {
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
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
      messages: multimodalMessages(),
      max_tokens: 16,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.contents[0].parts).toEqual([
      { text: 'describe this image' },
      {
        inlineData: {
          mimeType: 'image/png',
          data: 'iVBORw0KGgo=',
        },
      },
    ])
  })

  test('Gemini preserves tool-result images inside the function response', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        candidates: [
          {
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
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
      messages: imageToolHistoryMessages(),
      max_tokens: 16,
    })

    const [, body] = post.mock.calls[0] as [string, Record<string, any>]
    expect(body.contents[1].parts).toEqual([
      {
        functionResponse: {
          name: 'Computer',
          id: 'call_image',
          response: { result: 'screenshot captured' },
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'iVBORw0KGgo=',
              },
            },
          ],
        },
      },
    ])
  })

  test('malformed image blocks fail with a provider capability error instead of being dropped', async () => {
    spyOn(axios, 'post').mockResolvedValue({
      data: openAITextResponse,
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
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe this image' },
              { type: 'image', source: { type: 'unsupported', data: 'x' } },
            ],
          },
        ],
        max_tokens: 16,
      })
      throw new Error('expected malformed image block to throw')
    } catch (error) {
      expect((error as Error).name).toBe('ProviderCapabilityError')
      expect((error as Error).message).toContain('image')
      expect((error as Error).message).toContain('unsupported')
    }
  })
})
