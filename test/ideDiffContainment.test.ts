import { expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createIdeDiffBundle,
  deleteIdeDiffBundle,
  getIdeDiffBundle,
  listIdeDiffBundles,
  readIdeDiffPatch,
  setIdeDiffStatus,
} from '../src/services/agents/ideDiffs.ts'

const SAMPLE_DIFF =
  'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n'

test('IDE diff manifests cannot redirect patch or metadata access outside the store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ur-ide-diff-'))
  const outside = join(dir, 'outside.txt')
  try {
    writeFileSync(outside, 'untouched')
    const created = await createIdeDiffBundle(dir, {
      diff: SAMPLE_DIFF,
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

test('IDE diff store directories cannot be symlinked outside the project', async () => {
  if (process.platform === 'win32') return
  const dir = mkdtempSync(join(tmpdir(), 'ur-ide-diff-link-'))
  const outside = mkdtempSync(join(tmpdir(), 'ur-ide-diff-outside-'))
  try {
    mkdirSync(join(dir, '.ur', 'ide'), { recursive: true })
    symlinkSync(outside, join(dir, '.ur', 'ide', 'diffs'), 'dir')

    await expect(
      createIdeDiffBundle(dir, { diff: SAMPLE_DIFF }),
    ).rejects.toThrow('unsafe path')
    // A missing manifest is treated as an empty store without following the
    // linked directory. Any operation that would create or access state fails.
    expect(listIdeDiffBundles(dir)).toEqual([])
    expect(() => readFileSync(join(outside, 'manifest.json'))).toThrow()
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('IDE diff artifact symlinks are never read, overwritten, or used for deletion', async () => {
  if (process.platform === 'win32') return
  const dir = mkdtempSync(join(tmpdir(), 'ur-ide-diff-artifact-link-'))
  const outside = join(dir, 'outside.txt')
  try {
    writeFileSync(outside, 'outside-secret')
    const created = await createIdeDiffBundle(dir, { diff: SAMPLE_DIFF })
    expect(created.bundle?.id).toBe('diff-1')

    const patch = join(
      dir,
      '.ur',
      'ide',
      'diffs',
      'patches',
      'diff-1.patch',
    )
    rmSync(patch)
    symlinkSync(outside, patch)

    expect(readIdeDiffPatch.bind(null, dir, 'diff-1')).toThrow(
      'regular file',
    )
    expect(deleteIdeDiffBundle(dir, 'diff-1')).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('outside-secret')

    const metadata = join(
      dir,
      '.ur',
      'ide',
      'diffs',
      'metadata',
      'diff-1.json',
    )
    rmSync(metadata)
    symlinkSync(outside, metadata)
    expect(setIdeDiffStatus.bind(null, dir, 'diff-1', 'approved')).toThrow(
      'unsafe',
    )
    expect(readFileSync(outside, 'utf8')).toBe('outside-secret')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
