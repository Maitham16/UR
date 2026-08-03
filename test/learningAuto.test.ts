import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  outcomeFromRun,
  emptyStats,
  foldOutcomes,
  learnedModelForTask,
  loadStats,
  recordOutcome,
  recordOutcomes,
} from '../src/services/agents/learning.js'
import { resolveModelForTask } from '../src/services/agents/modelRouter.js'
import type { ModelCapability } from '../src/commands/model-doctor/model-doctor.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

// Automatic learning: runs record outcomes by themselves (no /learn run),
// and the auto routing strategy consumes the evidence.

describe('recordOutcome', () => {
  test('can be disabled explicitly', () => {
    const dir = tempDir('ur-learn-disabled-')
    const previous = process.env.UR_CODE_DISABLE_AUTO_LEARNING
    process.env.UR_CODE_DISABLE_AUTO_LEARNING = '1'
    try {
      recordOutcome(dir, { id: 'r1', task: 'fix failing unit tests', model: 'small-coder', pass: true })
      expect(loadStats(dir).seen).toHaveLength(0)
    } finally {
      if (previous === undefined) {
        delete process.env.UR_CODE_DISABLE_AUTO_LEARNING
      } else {
        process.env.UR_CODE_DISABLE_AUTO_LEARNING = previous
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('persists outcomes to the store and stays idempotent', () => {
    const dir = tempDir('ur-learn-auto-')
    try {
      recordOutcome(dir, { id: 'r1', task: 'fix failing unit tests', model: 'small-coder', pass: true })
      recordOutcome(dir, { id: 'r1', task: 'fix failing unit tests', model: 'small-coder', pass: true })
      const stats = loadStats(dir)
      expect(stats.models['small-coder']).toEqual({ pass: 1, fail: 0 })
      expect(stats.seen).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('never throws on an unwritable store', () => {
    // /dev/null/x is not a creatable directory — recordOutcome must swallow it.
    expect(() =>
      recordOutcome('/dev/null/x', { id: 'r', task: 't', model: null, pass: true }),
    ).not.toThrow()
  })

  test('batch records task outcomes atomically and idempotently', () => {
    const dir = tempDir('ur-learn-batch-')
    try {
      const outcomes = [
        { id: 'a', task: 'inspect parser', model: 'm1', pass: true },
        { id: 'b', task: 'inspect renderer', model: 'm1', pass: false },
      ]
      recordOutcomes(dir, outcomes)
      recordOutcomes(dir, outcomes)
      expect(loadStats(dir).models.m1).toEqual({ pass: 1, fail: 1 })
      expect(
        readdirSync(join(dir, '.ur', 'learning')).some(file =>
          file.endsWith('.tmp'),
        ),
      ).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('parallel processes do not lose task outcomes', async () => {
    const dir = tempDir('ur-learn-parallel-')
    try {
      const moduleUrl = new URL(
        '../src/services/agents/learning.ts',
        import.meta.url,
      ).href
      const children = Array.from({ length: 8 }, (_, index) =>
        Bun.spawn(
          [
            process.execPath,
            '-e',
            `import { recordOutcome } from ${JSON.stringify(moduleUrl)}; recordOutcome(process.env.LEARN_TEST_CWD, { id: 'child-${index}', task: 'inspect parser', model: 'm1', pass: true });`,
          ],
          {
            env: { ...process.env, LEARN_TEST_CWD: dir },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        ),
      )
      const results = await Promise.all(
        children.map(async child => ({
          code: await child.exited,
          stderr: await new Response(child.stderr).text(),
        })),
      )
      expect(results.every(result => result.code === 0), JSON.stringify(results)).toBe(
        true,
      )
      expect(loadStats(dir).models.m1).toEqual({ pass: 8, fail: 0 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('malformed valid JSON is normalized before learned routing', () => {
    const dir = tempDir('ur-learn-malformed-')
    try {
      const learningDir = join(dir, '.ur', 'learning')
      mkdirSync(learningDir, { recursive: true })
      writeFileSync(
        join(learningDir, 'stats.json'),
        JSON.stringify({
          version: 1,
          seen: ['ok', 42],
          models: { broken: null, valid: { pass: 2, fail: 1 } },
          categories: null,
          modelByCategory: null,
          lessons: ['keep evidence', false],
        }),
      )
      const stats = loadStats(dir)
      expect(stats.models).toEqual({ valid: { pass: 2, fail: 1 } })
      expect(stats.modelByCategory).toEqual({})
      expect(() => learnedModelForTask(stats, 'inspect parser')).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('learnedModelForTask', () => {
  // Build outcomes exactly like production does (outcomeFromRun derives the
  // category from the task text) so the category always matches the router's.
  const statsWith = (model: string, pass: number, fail: number) => {
    const outcomes = [
      ...Array.from({ length: pass }, (_, i) =>
        outcomeFromRun({ id: `p${i}`, task: 'run the unit tests', model, pass: true }),
      ),
      ...Array.from({ length: fail }, (_, i) =>
        outcomeFromRun({ id: `f${i}`, task: 'run the unit tests', model, pass: false }),
      ),
    ]
    return foldOutcomes(emptyStats(), outcomes)
  }

  test('returns the proven model with solid evidence', () => {
    expect(learnedModelForTask(statsWith('small-coder', 4, 1), 'run the unit tests')).toBe('small-coder')
  })

  test('returns null when evidence is thin', () => {
    expect(learnedModelForTask(statsWith('small-coder', 2, 0), 'run the unit tests')).toBeNull()
  })

  test('returns null when the track record is poor', () => {
    expect(learnedModelForTask(statsWith('small-coder', 1, 4), 'run the unit tests')).toBeNull()
  })
})

describe('resolveModelForTask learned routing', () => {
  const localModels = [
    { name: 'small-coder' },
    { name: 'big-coder' },
  ] as ModelCapability[]
  const pool = { cheap: ['small-coder'], strong: ['big-coder'], default: ['small-coder'] }

  test('auto prefers the learned best model when evidence is solid', () => {
    const dir = tempDir('ur-learn-route-')
    try {
      for (let i = 0; i < 5; i++) {
        recordOutcome(dir, { id: `w${i}`, task: 'run the unit tests', model: 'small-coder', pass: true })
      }
      const resolved = resolveModelForTask('run the unit tests', 'auto', pool, localModels, { cwd: dir })
      expect(resolved).toBe('small-coder')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('auto falls back to heuristics when there is no evidence', () => {
    const dir = tempDir('ur-learn-route-empty-')
    try {
      const withCwd = resolveModelForTask('run the unit tests', 'auto', pool, localModels, { cwd: dir })
      const withoutCwd = resolveModelForTask('run the unit tests', 'auto', pool, localModels)
      expect(withCwd).toBe(withoutCwd as string)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('explicit cheap/strong strategies ignore learned evidence', () => {
    const dir = tempDir('ur-learn-route-explicit-')
    try {
      for (let i = 0; i < 5; i++) {
        recordOutcome(dir, { id: `s${i}`, task: 'refactor the parser', model: 'small-coder', pass: true })
      }
      const strong = resolveModelForTask('refactor the parser', 'strong', pool, localModels, { cwd: dir })
      expect(strong).not.toBe('small-coder')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
