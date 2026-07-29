import { expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compareTaskIds,
  createTask,
  getTasksDir,
  listTasks,
} from '../src/utils/tasks.ts'

// listTasks returned whatever order readdir gave, which is lexicographic in
// practice. Under ten tasks that looks correct and hides the bug entirely;
// past ten it reads 1, 10, 11, 12, ... 2, 20, 3. Promise.all preserves input
// order, so nothing downstream recovered it — a 23-task list displayed
// scrambled with no other symptom.

test('ids sort as integers, not as strings', () => {
  const scrambled = ['1', '10', '11', '2', '20', '21', '3', '9']
  expect([...scrambled].sort(compareTaskIds)).toEqual([
    '1',
    '2',
    '3',
    '9',
    '10',
    '11',
    '20',
    '21',
  ])
})

test('the failure only appears past nine, which is why it hid', () => {
  // A nine-task list sorts identically either way. Any test written against a
  // short fixture would have passed against the broken code.
  const short = ['1', '2', '3']
  expect([...short].sort(compareTaskIds)).toEqual([...short].sort())
  const long = ['1', '2', '10']
  expect([...long].sort(compareTaskIds)).not.toEqual([...long].sort())
})

test('lexicographic order is genuinely wrong for a real list', () => {
  // The 23-task list that surfaced this.
  const ids = Array.from({ length: 23 }, (_, index) => String(index + 1))
  const lexicographic = [...ids].sort()
  const numeric = [...ids].sort(compareTaskIds)
  expect(lexicographic[1]).toBe('10')
  expect(numeric[1]).toBe('2')
  expect(numeric.at(-1)).toBe('23')
})

test('non-numeric ids stay ordered and never compare as NaN', () => {
  // NaN comparisons return false both ways, leaving the sort unspecified.
  const mixed = ['2', 'beta', '1', 'alpha']
  const sorted = [...mixed].sort(compareTaskIds)
  expect(sorted).toEqual(['1', '2', 'alpha', 'beta'])
})

test('numeric-looking prefixes are not treated as allocated integer ids', () => {
  const mixed = ['12-external', '10', '2beta', '2', '1e3', '3.5']
  expect([...mixed].sort(compareTaskIds)).toEqual([
    '2',
    '10',
    '12-external',
    '1e3',
    '2beta',
    '3.5',
  ])
})

test('the comparator is symmetric and stable', () => {
  // An inconsistent comparator produces different orders for the same input
  // depending on the engine's sort.
  const ids = ['5', '1', 'x', '10', 'a', '2']
  const once = [...ids].sort(compareTaskIds)
  const twice = [...ids].reverse().sort(compareTaskIds)
  expect(once).toEqual(twice)
  for (const a of ids) {
    for (const b of ids) {
      // Summing the signs avoids signed zero: for equal ids both are 0, and
      // `-Math.sign(0)` is -0, which toBe rejects against 0 under Object.is.
      // The comparator was never wrong; the assertion was.
      expect(
        Math.sign(compareTaskIds(a, b)) + Math.sign(compareTaskIds(b, a)),
      ).toBe(0)
    }
  }
})

test('listTasks returns real task files in numeric order past nine', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ur-task-order-'))
  const previousConfig = process.env.UR_CONFIG_DIR
  process.env.UR_CONFIG_DIR = root
  try {
    const taskListId = 'ordering'
    const dir = getTasksDir(taskListId)
    mkdirSync(dir, { recursive: true })
    for (const id of ['1', '10', '11', '2', '20', '3']) {
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({
          id,
          subject: `Task ${id}`,
          description: '',
          status: 'pending',
          blocks: [],
          blockedBy: [],
        }),
      )
    }

    expect((await listTasks(taskListId)).map(task => task.id)).toEqual([
      '1',
      '2',
      '3',
      '10',
      '11',
      '20',
    ])
  } finally {
    if (previousConfig === undefined) {
      delete process.env.UR_CONFIG_DIR
    } else {
      process.env.UR_CONFIG_DIR = previousConfig
    }
    rmSync(root, { recursive: true, force: true })
  }
})

test('external prefixed ids do not advance the numeric allocator', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ur-task-allocate-'))
  const previousConfig = process.env.UR_CONFIG_DIR
  process.env.UR_CONFIG_DIR = root
  try {
    const taskListId = 'allocation'
    const dir = getTasksDir(taskListId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, '12-external.json'),
      JSON.stringify({
        id: '12-external',
        subject: 'External task',
        description: '',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      }),
    )

    expect(
      await createTask(taskListId, {
        subject: 'First native task',
        description: '',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      }),
    ).toBe('1')
  } finally {
    if (previousConfig === undefined) {
      delete process.env.UR_CONFIG_DIR
    } else {
      process.env.UR_CONFIG_DIR = previousConfig
    }
    rmSync(root, { recursive: true, force: true })
  }
})
