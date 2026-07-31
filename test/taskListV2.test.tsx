import { describe, expect, it } from 'bun:test'
import figures from 'figures'
import { byIdAsc, getTaskIcon } from '../src/components/TaskListV2.js'
import type { Task } from '../src/utils/tasks.js'

// Tests the pure display logic of the pinned task panel. An earlier version
// of this file rendered the component with ink-testing-library (not a
// dependency — the repo ships a vendored Ink fork) and used bun's global
// mock.module() on src/utils/tasks.js and src/state/AppState.js, which
// replaced those modules for EVERY test file in the process and broke
// unrelated suites (BashTool validateInput, repoEdit organize-imports).
// Component-level render coverage needs a harness for the vendored Ink;
// until then this covers the exported logic without polluting the runner.

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    subject: `Task ${overrides.id}`,
    description: '',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    ...overrides,
  } as Task
}

describe('TaskListV2 display logic', () => {
  describe('byIdAsc', () => {
    it('sorts numeric ids numerically, not lexicographically', () => {
      const tasks = [makeTask({ id: '10' }), makeTask({ id: '2' }), makeTask({ id: '1' })]
      expect(tasks.sort(byIdAsc).map(t => t.id)).toEqual(['1', '2', '10'])
    })

    it('falls back to locale comparison for non-numeric ids', () => {
      const tasks = [makeTask({ id: 'b' }), makeTask({ id: 'a' })]
      expect(tasks.sort(byIdAsc).map(t => t.id)).toEqual(['a', 'b'])
    })
  })

  describe('getTaskIcon', () => {
    it('marks completed tasks with a success tick', () => {
      expect(getTaskIcon('completed')).toEqual({
        icon: figures.tick,
        color: 'success',
      })
    })

    it('marks in-progress tasks with a filled square in the accent color', () => {
      expect(getTaskIcon('in_progress')).toEqual({
        icon: figures.squareSmallFilled,
        color: 'ur',
      })
    })

    it('marks pending tasks with an empty square and no color', () => {
      expect(getTaskIcon('pending')).toEqual({
        icon: figures.squareSmall,
        color: undefined,
      })
    })

    it('marks failed tasks with an error cross', () => {
      expect(getTaskIcon('failed')).toEqual({
        icon: figures.cross,
        color: 'error',
      })
    })

    it('marks skipped tasks with a warning sign', () => {
      expect(getTaskIcon('skipped')).toEqual({
        icon: figures.warning,
        color: 'warning',
      })
    })
  })
})
