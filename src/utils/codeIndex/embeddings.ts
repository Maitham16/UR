/**
 * Local embedding client. Talks to the same local Ollama app UR already uses
 * for chat (http://localhost:11434), via the /api/embed endpoint, so the code
 * index stays local-first and needs no extra provider configuration.
 *
 * Pull a model first, e.g. `ollama pull nomic-embed-text`.
 */

import { getOllamaBaseUrl } from '../model/ollamaConfig.js'

export const DEFAULT_EMBED_MODEL = 'nomic-embed-text'

/** Embedding model id, overridable via UR_CODE_INDEX_EMBED_MODEL. */
export function getEmbeddingModel(
  env: Record<string, string | undefined> = process.env,
): string {
  return (env.UR_CODE_INDEX_EMBED_MODEL || '').trim() || DEFAULT_EMBED_MODEL
}

type EmbedResponse = {
  embeddings?: number[][]
  error?: string
}

/**
 * Embed a batch of texts. Returns one vector per input, in order.
 * Throws if Ollama is unreachable or the model is not pulled.
 */
export async function embedTexts(
  texts: string[],
  options: { model: string; signal?: AbortSignal },
): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }
  let response: Response
  try {
    response = await fetch(`${getOllamaBaseUrl()}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.model, input: texts }),
      signal: options.signal,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not reach the Ollama app at ${getOllamaBaseUrl()} for embeddings: ${message}`,
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Ollama embedding request failed (${response.status}): ${body || response.statusText}. ` +
        `Make sure the embedding model "${options.model}" is pulled (e.g. \`ollama pull ${options.model}\`).`,
    )
  }

  const json = (await response.json()) as EmbedResponse
  if (json.error) {
    throw new Error(`Ollama embedding error: ${json.error}`)
  }
  if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
    throw new Error(
      `Ollama returned ${json.embeddings?.length ?? 0} embeddings for ${texts.length} inputs`,
    )
  }
  return json.embeddings
}

/** Embed a single query string. */
export async function embedQuery(
  query: string,
  options: { model: string; signal?: AbortSignal },
): Promise<number[]> {
  const [vector] = await embedTexts([query], options)
  if (!vector) {
    throw new Error('Ollama returned no embedding for the query')
  }
  return vector
}
