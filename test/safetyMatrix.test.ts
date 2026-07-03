import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSafetyMatrix } from '../scripts/generate-safety-matrix.mjs'

const repoRoot = join(import.meta.dir, '..')

describe('generated safety matrix', () => {
  test('generates expected autonomous safety decisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-safety-matrix-'))
    try {
      const matrix = buildSafetyMatrix(dir)
      expect(matrix.caseCount).toBeGreaterThanOrEqual(16)
      for (const item of matrix.cases) {
        expect(item.actualDecision).toBe(item.expectedDecision)
        expect(item.testFile).toBe('test/safetyMatrix.test.ts')
        expect(item.sandboxAvailable).not.toBeUndefined()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('blocks tricky shell secret exfiltration variants', () => {
    const matrix = buildSafetyMatrix(repoRoot)
    const exfiltrationCases = matrix.cases.filter(item =>
      item.id.includes('secret') || item.id.includes('exfil'),
    )
    expect(exfiltrationCases.length).toBeGreaterThanOrEqual(10)
    for (const item of exfiltrationCases) {
      expect(item.actualDecision).toBe('deny')
      expect(item.sandboxRequired).toBe(true)
    }
  })

  test('allows harmless read-only command in autonomous mode', () => {
    const item = buildSafetyMatrix(repoRoot).cases.find(
      entry => entry.id === 'harmless-read-only',
    )
    expect(item).toBeDefined()
    expect(item?.actualDecision).toBe('allow')
    expect(item?.sandboxRequired).toBe(false)
    expect(item?.category).toBe('read-only')
  })

  test('checked-in matrix is fresh', () => {
    const result = spawnSync('bun', ['run', 'safety:matrix', '--', '--check'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Safety matrix is fresh')
  })
})
