import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addRunArtifact,
  appendRunAction,
  appendRunTestsLog,
  initializeResearchTrace,
  loadRunManifests,
  readRunActions,
  readRunManifest,
  runActionsPath,
  runArtifactsDir,
  runDiffPath,
  runManifestPath,
  runPlanPath,
  runReportPath,
  runTestsLogPath,
  upsertRunManifest,
  writeRunDiff,
  writeRunManifest,
  writeRunPlan,
  writeRunReport,
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

  test('initializeResearchTrace creates required research-grade files', () => {
    withTempDir(dir => {
      const manifest = initializeResearchTrace(dir, 'trace-1', {
        goal: 'prove trace bundle',
      })

      expect(manifest.runId).toBe('trace-1')
      expect(existsSync(runPlanPath(dir, 'trace-1'))).toBe(true)
      expect(existsSync(runActionsPath(dir, 'trace-1'))).toBe(true)
      expect(existsSync(runDiffPath(dir, 'trace-1'))).toBe(true)
      expect(existsSync(runTestsLogPath(dir, 'trace-1'))).toBe(true)
      expect(existsSync(runReportPath(dir, 'trace-1'))).toBe(true)

      const plan = JSON.parse(readFileSync(runPlanPath(dir, 'trace-1'), 'utf-8')) as {
        goal: string
      }
      expect(plan.goal).toBe('prove trace bundle')

      const kinds = readRunManifest(dir, 'trace-1')!.artifacts.map(a => a.kind)
      expect(kinds).toContain('plan')
      expect(kinds).toContain('actions')
      expect(kinds).toContain('diff')
      expect(kinds).toContain('tests-log')
      expect(kinds).toContain('report')
    })
  })

  test('trace artifact writers append actions and evidence', () => {
    withTempDir(dir => {
      writeRunPlan(dir, 'trace-2', { goal: 'run checks' })
      appendRunAction(dir, 'trace-2', {
        kind: 'command',
        status: 'passed',
        command: 'bun test',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        reason: 'run tests',
        nextAction: 'report success',
      })
      appendRunTestsLog(dir, 'trace-2', 'test output')
      writeRunDiff(dir, 'trace-2', 'diff --git a/a b/a\n')
      writeRunReport(dir, 'trace-2', '# report')

      const actions = readRunActions(dir, 'trace-2')
      expect(actions.length).toBe(1)
      expect(actions[0].command).toBe('bun test')
      expect(readFileSync(runTestsLogPath(dir, 'trace-2'), 'utf-8')).toContain('test output')
      expect(readFileSync(runDiffPath(dir, 'trace-2'), 'utf-8')).toContain('diff --git')
      expect(readFileSync(runReportPath(dir, 'trace-2'), 'utf-8')).toContain('# report')
    })
  })
})
