/**
 * OpenRouter API client.
 * OpenRouter provides access to multiple models through a single API.
 */

import { randomUUID } from 'crypto'
import {
  estimateProviderInputTokens,
  parseOpenAICompatibleResponse,
  toOpenAICompatibleRequest,
} from './openaiCompatible.js'
import {
  createOpenAISSEMessageStream,
  mergeAbortSignals,
} from './streamingAdapters.js'
import { axiosPostWithProviderReliability } from './providerHttp.js'

type URHQClient = {
  beta: { messages: any }
}

export async function createOpenRouterClient(
  options: {
    apiKey?: string
    maxRetries: number
    model?: string
  },
): Promise<URHQClient> {
  const { apiKey, maxRetries } = options
  const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

  async function doRequest(params: any, requestOptions?: any) {
    const clientRequestId = params?.headers?.['x-client-request-id']
    const response = await axiosPostWithProviderReliability<any>(
      `${OPENROUTER_BASE}/chat/completions`,
      toOpenAICompatibleRequest(params, 'openrouter'),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://ur-nexus.local',
          'X-Title': 'UR-Nexus',
          ...(clientRequestId && { 'x-client-request-id': clientRequestId }),
          ...(requestOptions?.headers ?? {}),
        },
      },
      {
        maxRetries,
        timeoutMs: requestOptions?.timeoutMs,
        signal: requestOptions?.signal,
      },
    )

    const data = response.data
    return {
      response,
      data: parseOpenAICompatibleResponse(
        data.id ? data : { ...data, id: `openrouter-${randomUUID()}` },
        params.model,
        'openrouter',
      ),
    }
  }

  async function doStream(params: any, requestOptions?: any, controller?: AbortController) {
    const clientRequestId = params?.headers?.['x-client-request-id']
    const streamController = controller ?? new AbortController()
    const signal = mergeAbortSignals([requestOptions?.signal, streamController.signal])

    const response = await axiosPostWithProviderReliability<any>(
      `${OPENROUTER_BASE}/chat/completions`,
      toOpenAICompatibleRequest({ ...params, stream: true }, 'openrouter'),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://ur-nexus.local',
          'X-Title': 'UR-Nexus',
          ...(clientRequestId && { 'x-client-request-id': clientRequestId }),
          ...(requestOptions?.headers ?? {}),
        },
        responseType: 'stream',
      },
      {
        maxRetries,
        timeoutMs: requestOptions?.timeoutMs,
        signal,
      },
    )
    const requestId = response.headers?.['x-request-id'] ?? `openrouter-${randomUUID()}`
    return {
      response,
      requestId,
      data: createOpenAISSEMessageStream(response.data, {
        controller: streamController,
        signal,
        model: params.model,
        requestId,
        providerName: 'openrouter',
      }),
    }
  }

  const messagesAPI = {
    create(params: any, options?: any) {
      if (params.stream) {
        const controller = new AbortController()
        const requestPromise = doStream(params, options, controller)
        return {
          async withResponse() {
            const { response, data, requestId } = await requestPromise
            return {
              data,
              response,
              request_id: requestId,
            }
          },
          controller,
        }
      }

      return doRequest(params, options).then(({ response, data }) => ({
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
  } as URHQClient
}

function estimateTokenCount(params: any): number {
  return estimateProviderInputTokens(params)
}
