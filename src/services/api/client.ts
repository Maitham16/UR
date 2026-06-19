// @ts-nocheck
import type Anthropic from '@anthropic-ai/sdk'
import { getAPIProvider } from 'src/utils/model/providers.js'

export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ConstructorParameters<typeof Anthropic>[0]['fetch']
  source?: string
}): Promise<Anthropic> {
  // UR only supports local Ollama execution. All first-party and cloud
  // provider branches (Anthropic direct, Bedrock, Vertex, Foundry/Azure) have
  // been removed from the external build.
  if (getAPIProvider() === 'ollama') {
    const { createOllamaAnthropicClient } = await import('./ollama.js')
    return createOllamaAnthropicClient() as Anthropic
  }

  // Defensive fallback: build a minimal local-Ollama client. This path is
  // unreachable while the provider is hardcoded to 'ollama'.
  const { createOllamaAnthropicClient } = await import('./ollama.js')
  return createOllamaAnthropicClient() as Anthropic
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'
