import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendTaskMemory,
  readTaskMemory,
} from '../src/services/context/projectContextManifest.js'
import {
  captureFileCitation,
  captureRunCitation,
  captureWebCitation,
  formatResolvedMemory,
  resolveTaskMemoryEntries,
  validateMemoryCitation,
} from '../src/services/context/memoryCitations.js'

describe('cited project memory', () => {
  test('captures bounded evidence and excludes stale memories from prompts', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-cited-memory-'))
    try {
      writeFileSync(join(cwd, 'policy.ts'), 'first\nuse safe policy\nlast\n')
      const citation = captureFileCitation(cwd, 'policy.ts', 2, 2)
      const entry = appendTaskMemory(cwd, 'decision', 'Use the safe policy.', {
        citations: [citation],
        status: 'accepted',
      })
      let resolved = resolveTaskMemoryEntries(cwd, readTaskMemory(cwd))
      expect(resolved.map(item => item.entry.id)).toEqual([entry.id])
      expect(resolved[0]!.freshness).toBe('fresh')
      expect(formatResolvedMemory(resolved)).toContain(`[mem:${entry.id}]`)
      expect(formatResolvedMemory(resolved)).toContain('policy.ts:2-2')

      writeFileSync(join(cwd, 'policy.ts'), 'first\npolicy changed\nlast\n')
      expect(validateMemoryCitation(cwd, citation).freshness).toBe('stale')
      expect(resolveTaskMemoryEntries(cwd, readTaskMemory(cwd))).toHaveLength(0)
      resolved = resolveTaskMemoryEntries(cwd, readTaskMemory(cwd), {
        includeStale: true,
      })
      expect(resolved[0]!.freshness).toBe('stale')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('validates run artifacts and filters rejected or superseded entries', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-cited-run-'))
    try {
      mkdirSync(join(cwd, '.ur', 'runs', 'run-1'), { recursive: true })
      writeFileSync(join(cwd, '.ur', 'runs', 'run-1', 'tests.log'), 'PASS\n')
      const runCitation = captureRunCitation(cwd, 'run-1', 'tests.log')
      const original = appendTaskMemory(cwd, 'note', 'old fact', {
        citations: [runCitation],
      })
      appendTaskMemory(cwd, 'note', 'replacement fact', {
        supersedesId: original.id,
        citations: [runCitation],
      })
      appendTaskMemory(cwd, 'note', 'bad fact', {
        status: 'rejected',
        citations: [runCitation],
      })
      const resolved = resolveTaskMemoryEntries(cwd, readTaskMemory(cwd))
      expect(resolved.map(item => item.entry.text)).toEqual(['replacement fact'])
      expect(() => captureFileCitation(cwd, '../outside', 1, 1)).toThrow()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('redacts common OAuth, signed-URL, and secret-like query values', () => {
    const citation = captureWebCitation(
      'https://example.com/callback?code=oauth-code&X-Amz-Credential=AKIAEXAMPLE%2Fscope&X-Amz-Signature=deadbeef&next=public&opaque=sk-abcdefghijklmnopqrstuvwxyz#access_token=fragment-secret',
    )
    expect(citation.url).toContain('code=%5Bredacted%5D')
    expect(citation.url).toContain('X-Amz-Credential=%5Bredacted%5D')
    expect(citation.url).toContain('X-Amz-Signature=%5Bredacted%5D')
    expect(citation.url).toContain('opaque=%5Bredacted%5D')
    expect(citation.url).toContain('next=public')
    expect(citation.url).not.toContain('oauth-code')
    expect(citation.url).not.toContain('fragment-secret')
    expect(citation.url).not.toContain('AKIAEXAMPLE')
  })
})
