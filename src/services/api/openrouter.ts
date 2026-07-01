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

  const messagesAPI = {
    async create(params: any) {
      try {
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
            },
            timeout: 60000,
          }
        )

        const data = response.data
        return {
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
        }
      } catch (error) {
        throw new Error(
          `OpenRouter API call failed: ${error instanceof Error ? error.message : 'unknown error'}`
        )
      }
    },
    async countTokens(params: any) {
      return {
        input_tokens: estimateTokenCount(params),
      }
    },
    async withResponse(params: any) {
      const clientRequestId = params?.headers?.['x-client-request-id']

      try {
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
            },
            timeout: 60000,
          }
        )

        const data = response.data
        return {
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
          response,
          request_id: data.id ?? response.headers?.['x-request-id'] ?? randomUUID(),
        }
      } catch (error) {
        throw new Error(
          `OpenRouter API call failed: ${error instanceof Error ? error.message : 'unknown error'}`
        )
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
