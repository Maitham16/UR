// @ts-nocheck
/**
 * OpenRouter API client.
 * OpenRouter provides access to multiple models through a single API.
 */

import type URHQ from '@urhq-ai/sdk'
import axios from 'axios'
import { randomUUID } from 'crypto'

export async function createOpenRouterClient(
  options: {
    apiKey?: string
    maxRetries: number
    model?: string
  },
): Promise<URHQ> {
  const { apiKey, maxRetries } = options
  const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

  async function doRequest(params: any, extraHeaders?: Record<string, string>) {
    const clientRequestId = params?.headers?.['x-client-request-id']

    const response = await axios.post(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        model: params.model,
        messages: params.messages,
        max_tokens: params.max_tokens,
        stream: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://ur-agent.local',
          'X-Title': 'UR-AGENT',
          ...(clientRequestId && { 'x-client-request-id': clientRequestId }),
          ...extraHeaders,
        },
        timeout: 60000,
      }
    )

    const data = response.data
    return {
      response,
      data: {
        id: `openrouter-${randomUUID()}`,
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
      },
    }
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

function estimateTokenCount(params: any): number {
  const text = JSON.stringify(params.messages ?? [])
  return Math.ceil(text.length / 4)
}
