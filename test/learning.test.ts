import { expect, test } from 'bun:test'
import type { Artifact } from '../src/services/agents/artifacts.ts'
import {
  bestModelForCategory,
  difficultyBias,
  emptyStats,
  foldOutcomes,
  formatStats,
  mineArtifacts,
  outcomeFromRun,
  reflectOnFailures,
  successRate,
  taskDifficultyBias,
  type Outcome,
} from '../src/services/agents/learning.ts'

function artifact(partial: Partial<Artifact>): Artifact {
  return {
    id: '1',
    kind: 'test-run',
    title: 'Test run: bun test',
    status: 'pending',
    feedback: [],
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
    ...partial,
  }
}

test('mineArtifacts turns test-run summaries into pass/fail outcomes', () => {
  const outcomes = mineArtifacts([
    artifact({ id: '1', summary: 'passed' }),
    artifact({ id: '2', summary: 'failed (exit 1)' }),
    artifact({ id: '3', summary: undefined }),
  ])
  expect(outcomes.map(o => o.pass)).toEqual([true, false])
})

test('mineArtifacts scores approved/rejected diffs and ignores pending', () => {
  const outcomes = mineArtifacts([
    artifact({ id: '4', kind: 'diff', title: 'cache fix', status: 'approved' }),
    artifact({ id: '5', kind: 'diff', title: 'bad fix', status: 'rejected' }),
    artifact({ id: '6', kind: 'diff', title: 'wip', status: 'pending' }),
  ])
  expect(outcomes).toHaveLength(2)
  expect(outcomes[0]!.pass).toBe(true)
  expect(outcomes[1]!.pass).toBe(false)
})

test('foldOutcomes is idempotent on repeated keys', () => {
  const outcomes: Outcome[] = [
    { key: 'a', category: 'coding', model: 'm1', pass: true, detail: 'x' },
    { key: 'a', category: 'coding', model: 'm1', pass: true, detail: 'x' },
  ]
  const stats = foldOutcomes(emptyStats(), outcomes)
  expect(stats.categories.coding).toEqual({ pass: 1, fail: 0 })
  expect(stats.models.m1).toEqual({ pass: 1, fail: 0 })
})

test('successRate and bestModelForCategory respect the sample floor', () => {
  let stats = emptyStats()
  stats = foldOutcomes(stats, [
    { key: '1', category: 'coding', model: 'fast', pass: true, detail: '' },
    { key: '2', category: 'coding', model: 'fast', pass: false, detail: '' },
    { key: '3', category: 'coding', model: 'oracle', pass: true, detail: '' },
    { key: '4', category: 'coding', model: 'oracle', pass: true, detail: '' },
    { key: '5', category: 'coding', model: 'oracle', pass: true, detail: '' },
  ])
  expect(successRate(stats, { category: 'coding', model: 'fast' })).toBe(0.5)
  // fast has only 2 samples (< default 3); oracle has 3 at 100% -> wins.
  expect(bestModelForCategory(stats, 'coding')).toEqual({ model: 'oracle', rate: 1 })
})

test('difficultyBias rises as the category success rate falls', () => {
  const reliable = foldOutcomes(
    emptyStats(),
    Array.from({ length: 5 }, (_, i) => ({
      key: `r${i}`,
      category: 'coding',
      model: null,
      pass: true,
      detail: '',
    })),
  )
  expect(difficultyBias(reliable, 'coding')).toBe(0)

  const flaky = foldOutcomes(
    emptyStats(),
    Array.from({ length: 5 }, (_, i) => ({
      key: `f${i}`,
      category: 'coding',
      model: null,
      pass: i === 0,
      detail: '',
    })),
  )
  expect(difficultyBias(flaky, 'coding')).toBe(4)
})

test('taskDifficultyBias routes a task to its learned category', () => {
  const stats = foldOutcomes(
    emptyStats(),
    Array.from({ length: 4 }, (_, i) => ({
      key: `c${i}`,
      category: 'coding',
      model: null,
      pass: false,
      detail: '',
    })),
  )
  expect(taskDifficultyBias(stats, 'write a function to add two numbers')).toBeGreaterThan(0)
})

test('outcomeFromRun derives a category and stable key', () => {
  const outcome = outcomeFromRun({
    id: 'arena-1',
    task: 'refactor the cache layer',
    model: 'qwen',
    pass: false,
  })
  expect(outcome.key).toBe('run:arena-1')
  expect(outcome.model).toBe('qwen')
})

test('reflectOnFailures uses the injected runner and caps lessons', async () => {
  const lessons = await reflectOnFailures({
    cwd: '/tmp',
    failures: ['flaky test in scheduler', 'null deref in parser'],
    maxLessons: 2,
    runner: async () => ({
      output: '- Add a retry guard to the scheduler test\n- Null-check parser input\n- extra',
      verdict: null,
      isError: false,
    }),
  })
  expect(lessons).toEqual([
    'Add a retry guard to the scheduler test',
    'Null-check parser input',
  ])
})

test('reflectOnFailures returns nothing when there are no failures', async () => {
  const lessons = await reflectOnFailures({ cwd: '/tmp', failures: [] })
  expect(lessons).toEqual([])
})

test('formatStats renders an empty store hint', () => {
  expect(formatStats(emptyStats(), false)).toContain('No outcomes yet')
})
