// @ts-nocheck
import type URHQ from '@urhq-ai/sdk'
import { getAPIProvider } from 'src/utils/model/providers.js'

export async function getURHQClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ConstructorParameters<typeof URHQ>[0]['fetch']
  source?: string
}): Promise<URHQ> {
  // UR only supports local Ollama execution. All first-party and cloud
  // provider branches (URHQ direct, Bedrock, Vertex, Foundry/Azure) have
  // been removed from the external build.
  if (getAPIProvider() === 'ollama') {
    const { createOllamaURHQClient } = await import('./ollama.js')
    return createOllamaURHQClient() as URHQ
  }

  // Defensive fallback: build a minimal local-Ollama client. This path is
  // unreachable while the provider is hardcoded to 'ollama'.
  const { createOllamaURHQClient } = await import('./ollama.js')
  return createOllamaURHQClient() as URHQ
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'
