import { describe, expect, test } from 'bun:test'
import { validateTaskDependencyInSnapshot as validateTaskDependency } from '../src/utils/tasks.js'
import type { Task } from '../src/utils/tasks.js'

function task(id: string, blocks: string[] = [], blockedBy: string[] = []): Task {
  return {
    id,
    subject: `Task ${id}`,
    description: '',
    status: 'pending',
    blocks,
    blockedBy,
  } as Task
}

/**
 * A plan written in dependency order arrives as forward references: step 2
 * declares it is blocked by step 8 while the list is still being built.
 * Rejecting those discarded most of the plan's structure, even though the read
 * side already treats an unresolved blocker correctly.
 */
describe('a dependency on a task that does not exist yet is accepted', () => {
  test('a forward reference is valid', () => {
    const tasks = [task('1'), task('2')]
    expect(validateTaskDependency(tasks, '2', '8')).toEqual({ valid: true })
  })

  test('several forward references from one task are all valid', () => {
    const tasks = [task('1'), task('2')]
    for (const target of ['7', '8', '10']) {
      expect(validateTaskDependency(tasks, '2', target)).toEqual({ valid: true })
    }
  })

  test('a future source is valid when the target exists', () => {
    // `blockedBy: ["8"]` expresses the future task as the source and stores
    // the pending half-edge on the existing target.
    expect(validateTaskDependency([task('1')], '8', '1')).toEqual({
      valid: true,
    })
  })

  test('an edge with no persisted endpoint is refused', () => {
    expect(validateTaskDependency([task('1')], '8', '9')).toEqual({
      valid: false,
      reason: 'task_not_found',
    })
  })

  test('a target below the highest issued id is a task that will never arrive', () => {
    // Ids are consecutive, so #3 with #1-#5 present was deleted, not pending.
    const tasks = ['1', '2', '4', '5'].map(id => task(id))
    expect(validateTaskDependency(tasks, '1', '3')).toEqual({
      valid: false,
      reason: 'task_not_found',
    })
  })

  test('a non-numeric target is refused rather than treated as pending', () => {
    // A typo must not become a blocker nothing can ever satisfy.
    expect(validateTaskDependency([task('1')], '1', 'missing')).toEqual({
      valid: false,
      reason: 'task_not_found',
    })
  })

  test('a non-numeric source is refused rather than treated as pending', () => {
    expect(validateTaskDependency([task('1')], 'missing', '1')).toEqual({
      valid: false,
      reason: 'task_not_found',
    })
  })
})

describe('the existing dependency rules are unchanged', () => {
  test('a self-dependency is still refused', () => {
    expect(validateTaskDependency([task('1')], '1', '1')).toEqual({
      valid: false,
      reason: 'self_dependency',
    })
  })

  test('a cycle between existing tasks is still refused', () => {
    const tasks = [task('1', ['2']), task('2')]
    expect(validateTaskDependency(tasks, '2', '1')).toEqual({
      valid: false,
      reason: 'cycle',
    })
  })

  test('an ordinary edge between existing tasks is still valid', () => {
    const tasks = [task('1'), task('2')]
    expect(validateTaskDependency(tasks, '2', '1')).toEqual({ valid: true })
  })

  test('a duplicate edge stays valid rather than reporting a cycle', () => {
    const tasks = [task('1', ['2']), task('2')]
    expect(validateTaskDependency(tasks, '1', '2')).toEqual({ valid: true })
  })

  test('a cycle through virtual forward nodes is refused', () => {
    const tasks = [
      task('1', ['3']),
      task('2', ['1']),
    ]
    expect(validateTaskDependency(tasks, '3', '2')).toEqual({
      valid: false,
      reason: 'cycle',
    })
  })
})
