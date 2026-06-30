import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addRunArtifact,
  loadRunManifests,
  readRunManifest,
  runArtifactsDir,
  runManifestPath,
  upsertRunManifest,
  writeRunManifest,
} from '../src/services/agents/runArtifacts.js'

function withTempDir(fn: (dir: string) => void): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'ur-run-artifacts-'))
  try {
    fn(tempDir)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

describe('run artifacts', () => {
  test('writeRunManifest creates manifest.json', () => {
    withTempDir(dir => {
      const manifest = writeRunManifest(dir, 'run-1', {
        startedAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        artifacts: [],
      })
      expect(manifest.runId).toBe('run-1')
      expect(manifest.version).toBe(1)
      expect(existsSync(runManifestPath(dir, 'run-1'))).toBe(true)
      expect(runArtifactsDir(dir, 'run-1')).toBe(join(dir, '.ur', 'runs', 'run-1'))
    })
  })

  test('readRunManifest returns parsed manifest', () => {
    withTempDir(dir => {
      writeRunManifest(dir, 'run-2', {
        startedAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        artifacts: [{ kind: 'command-log', path: 'commands.jsonl' }],
      })
      const read = readRunManifest(dir, 'run-2')
      expect(read).not.toBeNull()
      expect(read!.artifacts[0].kind).toBe('command-log')
    })
  })

  test('readRunManifest returns null for missing run', () => {
    withTempDir(dir => {
      expect(readRunManifest(dir, 'missing')).toBeNull()
    })
  })

  test('addRunArtifact appends and deduplicates by path', () => {
    withTempDir(dir => {
      addRunArtifact(dir, 'run-3', { kind: 'eval-report', path: 'report.json', title: 'r1' })
      addRunArtifact(dir, 'run-3', { kind: 'eval-report', path: 'report.json', title: 'r2' })
      addRunArtifact(dir, 'run-3', { kind: 'leaderboard', path: 'board.html' })
      const manifest = readRunManifest(dir, 'run-3')!
      expect(manifest.artifacts.length).toBe(2)
      expect(manifest.artifacts.find(a => a.path === 'report.json')?.title).toBe('r2')
      expect(manifest.artifacts.find(a => a.path === 'board.html')).toBeTruthy()
    })
  })

  test('loadRunManifests sorts by startedAt desc', () => {
    withTempDir(dir => {
      writeRunManifest(dir, 'old', {
        startedAt: '2026-06-28T00:00:00.000Z',
        updatedAt: '2026-06-28T00:00:00.000Z',
        artifacts: [],
      })
      writeRunManifest(dir, 'new', {
        startedAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        artifacts: [],
      })
      const all = loadRunManifests(dir)
      expect(all.map(m => m.runId)).toEqual(['new', 'old'])
    })
  })

  test('upsertRunManifest creates if missing', () => {
    withTempDir(dir => {
      const updated = upsertRunManifest(dir, 'run-up', m => ({
        ...m,
        artifacts: [...m.artifacts, { kind: 'pr-summary', path: 'pr.md' }],
      }))
      expect(updated.runId).toBe('run-up')
      expect(updated.artifacts.length).toBe(1)
    })
  })
})
