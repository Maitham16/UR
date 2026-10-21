/**
 * Persistence and vector math for the code index. The index is a single JSON
 * file under <root>/.ur/code-index/. Vectors are stored inline — simple, no
 * native deps, and fast enough for cosine scan over a typical repo's chunks.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CodeIndex } from './types.js'

export function codeIndexDir(root: string): string {
  return join(root, '.ur', 'code-index')
}

export function indexPath(root: string): string {
  return join(codeIndexDir(root), 'index.json')
}

export function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/** Cosine similarity. Returns 0 for mismatched/zero-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number
    const y = b[i] as number
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) {
    return 0
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export async function loadIndex(root: string): Promise<CodeIndex | null> {
  let raw: string
  try {
    raw = await readFile(indexPath(root), { encoding: 'utf-8' })
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as CodeIndex
    if (![1, 2].includes(parsed.version) || !parsed.chunks || !parsed.files || typeof parsed.model !== 'string') {
      return null
    }
    if (Object.values(parsed.files).some(file => !file || typeof file.hash !== 'string' || !Array.isArray(file.chunkIds))) return null
    if (Object.values(parsed.chunks).some(chunk => !chunk || typeof chunk.file !== 'string' || typeof chunk.text !== 'string' || !Array.isArray(chunk.vector))) return null
    return parsed
  } catch {
    return null
  }
}

export async function saveIndex(root: string, index: CodeIndex): Promise<void> {
  const path = indexPath(root)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(index), { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
