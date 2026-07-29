import { describe, expect, test } from 'bun:test'
import {
  countActiveTeammates,
  getBackgroundTaskActivityWidth,
  isBackgroundTaskVisibleInDialog,
  resolveBackgroundTaskSelection,
} from '../src/components/tasks/backgroundTaskDialogLogic.js'

describe('background task dialog logic', () => {
  test('preserves selection by task id when a newer row is inserted', () => {
    const before = [{ id: 'older' }, { id: 'oldest' }]
    const selectedId = before[1]!.id
    const after = [{ id: 'newest' }, ...before]

    expect(resolveBackgroundTaskSelection(after, selectedId)).toBe(2)
  })

  test('falls back safely when the selected task disappears', () => {
    expect(
      resolveBackgroundTaskSelection([{ id: 'remaining' }], 'removed'),
    ).toBe(0)
    expect(resolveBackgroundTaskSelection([], 'removed')).toBe(-1)
  })

  test('does not force a 30-column activity label in narrow terminals', () => {
    expect(getBackgroundTaskActivityWidth(40)).toBe(14)
    expect(getBackgroundTaskActivityWidth(20)).toBe(8)
    expect(getBackgroundTaskActivityWidth(100)).toBe(74)
  })

  test('counts pending teammates without counting the synthetic leader row', () => {
    expect(
      countActiveTeammates([
        { type: 'leader', status: 'running' },
        { type: 'in_process_teammate', status: 'running' },
        { type: 'in_process_teammate', status: 'pending' },
        { type: 'in_process_teammate', status: 'completed' },
      ]),
    ).toBe(2)
  })

  test('uses the same visibility rules for auto-open and rendered rows', () => {
    const teammate = { id: 't1', type: 'in_process_teammate' }
    const foregroundAgent = { id: 'a1', type: 'local_agent' }
    const shell = { id: 'b1', type: 'local_bash' }

    expect(isBackgroundTaskVisibleInDialog(teammate, undefined, true)).toBe(false)
    expect(isBackgroundTaskVisibleInDialog(teammate, undefined, false)).toBe(true)
    expect(isBackgroundTaskVisibleInDialog(foregroundAgent, 'a1', false)).toBe(false)
    expect(isBackgroundTaskVisibleInDialog(shell, 'a1', true)).toBe(true)
  })
})
