/** Unicode-aware lexical retrieval shared by memory and repository search. */
const STOP_WORDS = new Set('a an and are as at be but by can do for from how i in is it me my of on or our please should that the this to use we what when with you'.split(' '))

export function retrievalTerms(text: string): string[] {
  const normalized = text.replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2').normalize('NFKC').toLowerCase()
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const terms: string[] = []
  for (const word of words) {
    if (!STOP_WORDS.has(word)) terms.push(word)
    // Space-less scripts need substrings; whole-word matching alone misses
    // e.g. a Chinese question against a longer sentence in a memory body.
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(word)) {
      const chars = [...word]
      for (let i = 0; i < chars.length - 1; i++) terms.push(chars.slice(i, i + 2).join(''))
    }
  }
  return [...new Set(terms)]
}

/** BM25 with document frequencies, normalized to [0,1]. */
export function lexicalScores(query: string, texts: string[]): number[] {
  const terms = retrievalTerms(query)
  if (!terms.length || !texts.length) return texts.map(() => 0)
  const documents = texts.map(text => retrievalTerms(text))
  const sets = documents.map(words => new Set(words))
  const avgLength = documents.reduce((sum, words) => sum + words.length, 0) / documents.length || 1
  const idfs = new Map(terms.map(term => {
    const count = sets.reduce((sum, set) => sum + Number(set.has(term)), 0)
    return [term, Math.log(1 + (texts.length - count + 0.5) / (count + 0.5))]
  }))
  const ceiling = [...idfs.values()].reduce((sum, idf) => sum + idf * 2.2, 0) || 1
  return documents.map((words, i) => {
    let score = 0
    for (const term of terms) {
      if (sets[i]!.has(term)) score += idfs.get(term)! * 2.2 / (1 + 1.2 * (0.25 + 0.75 * words.length / avgLength))
    }
    return score / ceiling
  })
}

export function validEmbedding(vector: unknown): vector is number[] {
  return Array.isArray(vector) && vector.length > 0 && vector.every(v => typeof v === 'number' && Number.isFinite(v)) && vector.some(v => v !== 0)
}

export type EmbeddingFunction = (texts: string[], options: { model: string; signal?: AbortSignal }) => Promise<number[][]>

export function validateEmbeddings(vectors: unknown, count: number, expectedDimension?: number): asserts vectors is number[][] {
  if (!Array.isArray(vectors) || vectors.length !== count || vectors.some(vector => !validEmbedding(vector) || vector.length !== (expectedDimension || vectors[0]?.length))) {
    throw new Error('Embedding service returned invalid or inconsistent vectors')
  }
}

/** Bound filesystem concurrency without creating thousands of open handles. */
export async function mapConcurrent<T, R>(items: T[], action: (item: T) => Promise<R>, concurrency = 16): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await action(items[i]!)
    }
  }))
  return results
}
