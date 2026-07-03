/**
 * OpenRouter API client.
 * OpenRouter provides access to multiple models through a single API.
 */

import { randomUUID } from 'crypto'
import {
  mapOpenAIToolChoice,
  parseOpenAICompatibleResponse,
  toOpenAIMessages,
  toOpenAITools,
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
    const tools = toOpenAITools(params.tools)

    const response = await axiosPostWithProviderReliability<any>(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        model: params.model,
        messages: toOpenAIMessages(params, 'openrouter'),
        max_tokens: params.max_tokens,
        stream: Boolean(params.stream),
        ...(tools.length > 0 ? { tools } : {}),
        ...(params.tool_choice !== undefined
          ? { tool_choice: mapOpenAIToolChoice(params.tool_choice) }
          : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://ur-agent.local',
          'X-Title': 'UR-AGENT',
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
    const tools = toOpenAITools(params.tools)
    const streamController = controller ?? new AbortController()
    const signal = mergeAbortSignals([requestOptions?.signal, streamController.signal])

    const response = await axiosPostWithProviderReliability<any>(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        model: params.model,
        messages: toOpenAIMessages(params, 'openrouter'),
        max_tokens: params.max_tokens,
        stream: true,
        ...(tools.length > 0 ? { tools } : {}),
        ...(params.tool_choice !== undefined
          ? { tool_choice: mapOpenAIToolChoice(params.tool_choice) }
          : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://ur-agent.local',
          'X-Title': 'UR-AGENT',
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
  const text = JSON.stringify(params.messages ?? [])
  return Math.ceil(text.length / 4)
}
