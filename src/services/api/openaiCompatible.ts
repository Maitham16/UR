// @ts-nocheck
/**
 * OpenAI-compatible client for local providers.
 * Supports LM Studio, llama.cpp, vLLM, and other OpenAI-compatible endpoints.
 */

import type URHQ from '@urhq-ai/sdk'
import { createOllamaURHQClient } from './ollama.js'

/**
 * Create an OpenAI-compatible client with custom base URL.
 * Used for LM Studio, llama.cpp, vLLM, and other compatible servers.
 */
export async function createOpenAICompatibleClient(
  options: {
    baseUrl: string
    apiKey?: string
    maxRetries?: number
  },
): Promise<URHQ> {
  // Reuse the Ollama client which already supports OpenAI-compatible format
  // but override the base URL
  return createOllamaURHQClient({
    baseUrlOverride: options.baseUrl,
  }) as URHQ
}
