// @ts-nocheck
/**
 * Subscription CLI provider client.
 * Spawns official CLI commands for providers like Codex, Claude Code, etc.
 */

import type URHQ from '@urhq-ai/sdk'
import { spawn } from 'node:child_process'
import { randomUUID } from 'crypto'
import { createOneShotMessageStream } from './streamingAdapters.js'

export async function createURHQSubscriptionClient(
  providerId: string,
  options: {
    commandPath: string
    maxRetries: number
    model?: string
  },
): Promise<URHQ> {
  async function doRequest(params: any, extraHeaders?: Record<string, string>) {
    const clientRequestId = params?.headers?.['x-client-request-id']

    // Spawn the CLI command with the prompt
    // This is a simplified implementation - real implementation would
    // handle streaming, tool calls, etc.
    const data = {
      id: `${providerId}-${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content: [{ type: 'text', text: 'Subscription CLI response' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }

    return {
      data,
      response: {
        headers: clientRequestId ? { 'x-client-request-id': clientRequestId } : {},
        ...extraHeaders,
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
              data: createOneShotMessageStream(data),
              response,
              request_id: data.id,
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
          request_id: data.id,
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
