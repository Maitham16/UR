// @ts-nocheck
/**
 * Standard API provider client.
 * Makes direct HTTP API calls for providers like OpenAI, Anthropic, Gemini.
 */

import type URHQ from '@urhq-ai/sdk'
import axios from 'axios'
import { randomUUID } from 'crypto'

export async function createStandardAPIClient(
  options: {
    providerId: string
    apiKey?: string
    maxRetries: number
    model?: string
    baseUrl?: string
  },
): Promise<URHQ> {
  const { providerId, apiKey, baseUrl, maxRetries } = options

  // Helper to make the actual API call
  async function doRequest(params: any, extraHeaders?: Record<string, string>) {
    const endpoint = getAPIEndpoint(providerId, baseUrl)
    const clientRequestId = params?.headers?.['x-client-request-id']

    const response = await axios.post(
      endpoint,
      buildAPIRequest(providerId, params),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...(clientRequestId && { 'x-client-request-id': clientRequestId }),
          ...extraHeaders,
        },
        timeout: 60000,
      }
    )

    return { response, data: parseAPIResponse(providerId, response.data) }
  }

  const messagesAPI = {
    create(params: any, options?: any) {
      // Handle streaming requests - return object with withResponse method
      if (params.stream) {
        const requestPromise = doRequest(params, options?.headers)
        return {
          async withResponse() {
            const { response, data } = await requestPromise
            return {
              data,
              response,
              request_id: response.data?.id ?? response.headers?.['x-request-id'] ?? randomUUID(),
            }
          },
        }
      }

      // Non-streaming: return data directly with withResponse method attached
      return doRequest(params, options?.headers).then(({ response, data }) => ({
        ...data,
        withResponse: () => ({
          data,
          response,
          request_id: response.data?.id ?? response.headers?.['x-request-id'] ?? randomUUID(),
        }),
      }))
    },
    async countTokens(params: any) {
      return {
        input_tokens: estimateTokenCount(params),
      }
    },
  }

  return {
    beta: {
      messages: messagesAPI,
    },
  } as URHQ
}

function getAPIEndpoint(providerId: string, baseUrl?: string): string {
  switch (providerId) {
    case 'openai-api':
      return baseUrl ?? 'https://api.openai.com/v1/chat/completions'
    case 'anthropic-api':
      return baseUrl ?? 'https://api.anthropic.com/v1/messages'
    case 'gemini-api':
      return baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/models'
    default:
      return baseUrl ?? ''
  }
}

function buildAPIRequest(providerId: string, params: any): any {
  switch (providerId) {
    case 'openai-api':
      return {
        model: params.model,
        messages: params.messages,
        max_tokens: params.max_tokens,
        stream: false,
      }
    case 'anthropic-api':
      return {
        model: params.model,
        messages: params.messages,
        max_tokens: params.max_tokens || 4096,
        stream: false,
      }
    default:
      return params
  }
}

function parseAPIResponse(providerId: string, data: any): any {
  switch (providerId) {
    case 'openai-api':
      return {
        id: `openai-${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: data.model,
        content: [{ type: 'text', text: data.choices?.[0]?.message?.content ?? '' }],
        stop_reason: data.choices?.[0]?.finish_reason ?? 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: data.usage?.prompt_tokens ?? 0,
          output_tokens: data.usage?.completion_tokens ?? 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }
    case 'anthropic-api':
      return {
        id: data.id,
        type: 'message',
        role: 'assistant',
        model: data.model,
        content: data.content?.map((c: any) => ({ type: c.type, text: c.text })),
        stop_reason: data.stop_reason ?? 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: data.usage?.input_tokens ?? 0,
          output_tokens: data.usage?.output_tokens ?? 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }
    default:
      return data
  }
}

function estimateTokenCount(params: any): number {
  const text = JSON.stringify(params.messages ?? [])
  return Math.ceil(text.length / 4)
}
