import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createIdeDiffBundle, getIdeDiffBundle, listIdeDiffBundles } from '../src/services/agents/ideDiffs.ts'

test('IDE diff manifests cannot redirect patch or metadata access outside the store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ur-ide-diff-'))
  const outside = join(dir, 'outside.txt')
  try {
    writeFileSync(outside, 'untouched')
    const created = await createIdeDiffBundle(dir, {
      diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
    })
    expect(created.bundle?.id).toBe('diff-1')
    const manifestPath = join(dir, '.ur', 'ide', 'diffs', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.diffs[0].patchFile = '../../../../outside.txt'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(listIdeDiffBundles(dir)).toEqual([])
    expect(getIdeDiffBundle(dir, 'diff-1')).toBeNull()
    expect(readFileSync(outside, 'utf8')).toBe('untouched')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
