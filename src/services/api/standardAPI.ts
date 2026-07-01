// @ts-nocheck
/**
 * Standard API provider client.
 * Direct HTTP for OpenAI, Anthropic and Gemini, shaped per provider family so
 * each request/response matches the target wire format.
 */

import type URHQ from '@urhq-ai/sdk'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { getProviderFamily } from '../providers/providerRegistry.js'
import { createOneShotMessageStream } from './streamingAdapters.js'

const ANTHROPIC_VERSION = '2023-06-01'

export async function createStandardAPIClient(options: {
  providerId: string
  apiKey?: string
  maxRetries: number
  model?: string
  baseUrl?: string
}): Promise<URHQ> {
  const { providerId, apiKey, baseUrl } = options
  const family = getProviderFamily(providerId)

  async function doRequest(params: any, extraHeaders?: Record<string, string>) {
    const endpoint = getAPIEndpoint(family, baseUrl, params.model)
    const clientRequestId = params?.headers?.['x-client-request-id']
    const response = await axios.post(endpoint, buildAPIRequest(family, params), {
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(family, apiKey, params),
        ...(clientRequestId && { 'x-client-request-id': clientRequestId }),
        ...extraHeaders,
      },
      timeout: 60_000,
    })
    return { response, data: parseAPIResponse(family, response.data, params.model) }
  }

  const messagesAPI = {
    create(params: any, requestOptions?: any) {
      if (params.stream) {
        const pending = doRequest(params, requestOptions?.headers)
        return {
          async withResponse() {
            const { response, data } = await pending
            return {
              data: createOneShotMessageStream(data),
              response,
              request_id: data.id ?? response.headers?.['x-request-id'] ?? randomUUID(),
            }
          },
        }
      }
      return doRequest(params, requestOptions?.headers).then(({ response, data }) => ({
        ...data,
        withResponse: () => ({
          data,
          response,
          request_id: data.id ?? response.headers?.['x-request-id'] ?? randomUUID(),
        }),
      }))
    },
    async countTokens(params: any) {
      return { input_tokens: estimateTokenCount(params) }
    },
  }

  return { beta: { messages: messagesAPI } } as URHQ
}

function getAPIEndpoint(family: string, baseUrl: string | undefined, model: string): string {
  switch (family) {
    case 'openai':
      return baseUrl ?? 'https://api.openai.com/v1/chat/completions'
    case 'anthropic':
      return baseUrl ?? 'https://api.anthropic.com/v1/messages'
    case 'google': {
      const root = baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
      return `${root.replace(/\/$/, '')}/models/${model}:generateContent`
    }
    default:
      return baseUrl ?? ''
  }
}

function buildAuthHeaders(
  family: string,
  apiKey: string | undefined,
  params: any,
): Record<string, string> {
  switch (family) {
    case 'anthropic': {
      const headers: Record<string, string> = {
        'x-api-key': apiKey ?? '',
        'anthropic-version': ANTHROPIC_VERSION,
      }
      if (Array.isArray(params.betas) && params.betas.length > 0) {
        headers['anthropic-beta'] = params.betas.join(',')
      }
      return headers
    }
    case 'google':
      return { 'x-goog-api-key': apiKey ?? '' }
    default:
      return { Authorization: `Bearer ${apiKey ?? ''}` }
  }
}

function buildAPIRequest(family: string, params: any): any {
  switch (family) {
    case 'openai':
      return {
        model: params.model,
        messages: toOpenAIMessages(params),
        max_tokens: params.max_tokens,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        stream: false,
      }
    case 'anthropic':
      return {
        model: params.model,
        ...(params.system && { system: params.system }),
        messages: params.messages,
        max_tokens: params.max_tokens ?? 4096,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        stream: false,
      }
    case 'google':
      return {
        contents: toGeminiContents(params),
        ...(geminiSystemInstruction(params) && {
          systemInstruction: geminiSystemInstruction(params),
        }),
        generationConfig: {
          ...(params.max_tokens && { maxOutputTokens: params.max_tokens }),
          ...(params.temperature !== undefined && { temperature: params.temperature }),
        },
      }
    default:
      return params
  }
}

function parseAPIResponse(family: string, data: any, fallbackModel: string): any {
  switch (family) {
    case 'openai':
      return {
        id: data.id ?? `openai-${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: data.model ?? fallbackModel,
        content: [{ type: 'text', text: data.choices?.[0]?.message?.content ?? '' }],
        stop_reason: mapStopReason(data.choices?.[0]?.finish_reason),
        stop_sequence: null,
        usage: {
          input_tokens: data.usage?.prompt_tokens ?? 0,
          output_tokens: data.usage?.completion_tokens ?? 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }
    case 'anthropic':
      return {
        id: data.id ?? `anthropic-${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: data.model ?? fallbackModel,
        content: Array.isArray(data.content)
          ? data.content.map((block: any) => ({ type: block.type, text: block.text }))
          : [{ type: 'text', text: '' }],
        stop_reason: data.stop_reason ?? 'end_turn',
        stop_sequence: data.stop_sequence ?? null,
        usage: {
          input_tokens: data.usage?.input_tokens ?? 0,
          output_tokens: data.usage?.output_tokens ?? 0,
          cache_creation_input_tokens: data.usage?.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: data.usage?.cache_read_input_tokens ?? 0,
        },
      }
    case 'google': {
      const parts = data.candidates?.[0]?.content?.parts ?? []
      return {
        id: `gemini-${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: fallbackModel,
        content: [{ type: 'text', text: parts.map((part: any) => part?.text ?? '').join('') }],
        stop_reason: mapStopReason(data.candidates?.[0]?.finishReason),
        stop_sequence: null,
        usage: {
          input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }
    }
    default:
      return data
  }
}

function mapStopReason(reason: string | undefined): string {
  switch (reason) {
    case 'length':
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'stop':
    case 'STOP':
    case undefined:
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

function toOpenAIMessages(params: any): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []
  const system = systemToText(params.system)
  if (system) messages.push({ role: 'system', content: system })
  for (const message of params.messages ?? []) {
    messages.push({ role: message.role, content: contentToText(message.content) })
  }
  return messages
}

function toGeminiContents(params: any): Array<{ role: string; parts: Array<{ text: string }> }> {
  return (params.messages ?? []).map((message: any) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: contentToText(message.content) }],
  }))
}

function geminiSystemInstruction(params: any): { parts: Array<{ text: string }> } | undefined {
  const system = systemToText(params.system)
  return system ? { parts: [{ text: system }] } : undefined
}

function systemToText(system: any): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) return system.map(block => block?.text ?? '').join('\n\n')
  return ''
}

function contentToText(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text ?? ''
      if (block?.type === 'tool_result') return contentToText(block.content)
      return ''
    })
    .join('\n')
}

function estimateTokenCount(params: any): number {
  return Math.ceil(JSON.stringify(params.messages ?? []).length / 4)
}
