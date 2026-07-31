import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HeadlessRunner } from '../src/services/agents/headlessAgent.js'
import {
  createCrew,
  decomposeGoal,
  loadCrew,
} from '../src/services/agents/crew.js'
import {
  decomposeTask,
  formatDecomposition,
  riskLevelFromKeywords,
} from '../src/services/agents/decomposer.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('decomposer', () => {
  test('deterministic fallback reuses decomposeGoal and adds metadata', async () => {
    const dir = tempDir('ur-decomp-')
    const tasks = await decomposeTask('1. add parser 2. add tests', { cwd: dir, dryRun: true })
    expect(tasks.length).toBe(2)
    expect(tasks[0].goal).toContain('parser')
    expect(tasks[0].id).toBe('t1')
    expect(tasks[0].risk).toBe('medium')
    expect(tasks[0].testsRequired).toContain('existing test suite')
    expect(tasks[0].rollbackPoint).toMatch(/^(untracked|[a-f0-9]{40})$/)
    rmSync(dir, { recursive: true, force: true })
  })

  test('risk heuristics classify security/auth as high', () => {
    expect(riskLevelFromKeywords('refactor login auth tokens', [])).toBe('high')
    expect(riskLevelFromKeywords('update README formatting', [])).toBe('low')
    expect(riskLevelFromKeywords('rename service interface', [])).toBe('medium')
    expect(riskLevelFromKeywords('add helper', [])).toBe('medium')
  })

  test('dry-run model path returns mock JSON', async () => {
    const dir = tempDir('ur-decomp-dry-')
    const runner: HeadlessRunner = async () => ({
      output: JSON.stringify({
        tasks: [
          { id: 't1', goal: 'a', filesTouched: ['src/a.ts'], risk: 'low', testsRequired: ['unit'], rollbackPoint: 'HEAD' },
        ],
      }),
      verdict: null,
      isError: false,
    })
    const tasks = await decomposeTask('do thing', { cwd: dir, runner })
    expect(tasks[0].goal).toBe('a')
    expect(tasks[0].filesTouched).toEqual(['src/a.ts'])
    rmSync(dir, { recursive: true, force: true })
  })

  test('createCrew with decomposed tasks persists metadata', async () => {
    const dir = tempDir('ur-decomp-crew-')
    const tasks = await decomposeTask('1. fix auth 2. add tests', { cwd: dir, dryRun: true })
    createCrew(dir, 'auth-crew', 'fix auth', { decomposed: tasks })
    const spec = loadCrew(dir, 'auth-crew')
    expect(spec?.tasks.length).toBe(2)
    expect(spec?.tasks[0].risk).toBe('high')
    expect(spec?.tasks[0].filesTouched?.length).toBe(0)
    expect(spec?.tasks[0].testsRequired).toContain('existing test suite')
    expect(spec?.tasks[0].rollbackPoint).toBeDefined()
    rmSync(dir, { recursive: true, force: true })
  })

  test('formatDecomposition prints JSON and text', () => {
    const result = {
      goal: 'g',
      rollbackPoint: 'abc',
      generatedAt: '2026-01-01',
      tasks: [
        {
          id: 't1',
          goal: 'x',
          filesTouched: ['src/x.ts'],
          risk: 'low' as const,
          testsRequired: ['unit'],
          rollbackPoint: 'abc',
        },
      ],
    }
    const json = formatDecomposition(result, true)
    expect(JSON.parse(json).tasks[0].goal).toBe('x')
    const text = formatDecomposition(result, false)
    expect(text).toContain('[LOW]')
    expect(text).toContain('src/x.ts')
  })
})
