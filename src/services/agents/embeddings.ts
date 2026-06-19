/**
 * Optional local embeddings for dense knowledge retrieval.
 *
 * The default provider talks to the local Ollama embeddings endpoint, but the
 * `Embedder` interface is injectable so retrieval ranking can be unit-tested
 * without a model. Falls back gracefully: callers keep lexical search when no
 * embedder is available or a request fails.
 */

export type Embedder = (texts: string[]) => Promise<number[][]>

export const DEFAULT_EMBED_MODEL = 'nomic-embed-text'

export function getOllamaEmbedBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.OLLAMA_BASE_URL || env.OLLAMA_HOST || 'http://localhost:11434'
  return /^https?:\/\//.test(raw) ? raw : `http://${raw}`
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function makeOllamaEmbedder(
  model: string = DEFAULT_EMBED_MODEL,
  baseUrl: string = getOllamaEmbedBaseUrl(),
): Embedder {
  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return []
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
    })
    if (!response.ok) {
      throw new Error(`Ollama embed failed: ${response.status} ${response.statusText}`)
    }
    const data = (await response.json()) as { embeddings?: number[][] }
    if (!Array.isArray(data.embeddings)) {
      throw new Error('Ollama embed response missing embeddings')
    }
    return data.embeddings
  }
}
