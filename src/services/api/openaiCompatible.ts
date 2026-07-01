// @ts-nocheck
/**
 * OpenAI-compatible client for local/server providers.
 * Supports LM Studio, llama.cpp, vLLM, and other compatible endpoints.
 */

import type URHQ from '@urhq-ai/sdk'
import { randomUUID } from 'crypto'
import { createOneShotMessageStream } from './streamingAdapters.js'

export async function createOpenAICompatibleClient(
  options: {
    baseUrl: string
    apiKey?: string
    maxRetries?: number
  },
): Promise<URHQ> {
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`

  async function doRequest(params: any, requestOptions?: any) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey
          ? { Authorization: `Bearer ${options.apiKey}` }
          : {}),
        ...(requestOptions?.headers ?? {}),
      },
      body: JSON.stringify(toOpenAICompatibleRequest(params)),
      signal: requestOptions?.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `OpenAI-compatible request failed for ${endpoint} (${response.status}): ${body || response.statusText}`,
      )
    }

    const data = await response.json()
    return {
      response,
      data: parseOpenAICompatibleResponse(data, params.model),
    }
  }

  return {
    beta: {
      messages: {
        create(params: any, requestOptions?: any) {
          if (params.stream) {
            const requestPromise = doRequest(
              { ...params, stream: false },
              requestOptions,
            )
            return {
              async withResponse() {
                const { response, data } = await requestPromise
                return {
                  data: createOneShotMessageStream(data),
                  response,
                  request_id:
                    response.headers.get('x-request-id') ??
                    response.headers.get('x-request-id'.toLowerCase()) ??
                    data.id,
                }
              },
            }
          }
          return doRequest(params, requestOptions).then(({ data }) => data)
        },
        async countTokens(params: any) {
          return {
            input_tokens: Math.ceil(JSON.stringify(params.messages ?? []).length / 4),
          }
        },
      },
    },
  } as URHQ
}

function toOpenAICompatibleRequest(params: any): any {
  return {
    model: params.model,
    messages: toOpenAIMessages(params),
    max_tokens: params.max_tokens,
    temperature: params.temperature,
    stream: false,
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
  }
}

function toOpenAIMessages(params: any): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []
  const system = systemToText(params.system)
  if (system) {
    messages.push({ role: 'system', content: system })
  }
  for (const message of params.messages ?? []) {
    messages.push({
      role: message.role,
      content: contentToText(message.content),
    })
  }
  return messages
}

function systemToText(system: any): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system.map(block => block?.text ?? '').join('\n\n')
  }
  return ''
}

function contentToText(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text ?? ''
      if (block?.type === 'tool_result') return block.content ?? ''
      return ''
    })
    .join('\n')
}

function parseOpenAICompatibleResponse(data: any, fallbackModel: string): any {
  const choice = data.choices?.[0]
  return {
    id: data.id ?? `openai-compatible-${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: data.model ?? fallbackModel,
    content: [
      {
        type: 'text',
        text: choice?.message?.content ?? choice?.text ?? '',
      },
    ],
    stop_reason: choice?.finish_reason ?? 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}
