import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  getTasksDir,
  inspectTaskListForGate,
  listTasks,
} from '../src/utils/tasks.ts'

let configRoot = ''
let previousConfigDir: string | undefined

function taskSnapshot(id: string): Record<string, unknown> {
  return {
    id,
    subject: `Task ${id}`,
    description: `Task ${id}`,
    status: 'pending',
    blocks: [],
    blockedBy: [],
  }
}

function writeSnapshot(
  taskListId: string,
  fileId: string,
  value: unknown,
): void {
  const dir = getTasksDir(taskListId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${fileId}.json`), JSON.stringify(value))
}

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), 'ur-task-gate-store-'))
  previousConfigDir = process.env.UR_CONFIG_DIR
  process.env.UR_CONFIG_DIR = configRoot
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.UR_CONFIG_DIR
  else process.env.UR_CONFIG_DIR = previousConfigDir
  rmSync(configRoot, { recursive: true, force: true })
})

describe('strict task-store inspection for the mutation gate', () => {
  test('only a missing task-list directory is treated as an empty list', async () => {
    await expect(inspectTaskListForGate('missing')).resolves.toEqual({
      tasks: [],
      taskCount: 0,
    })

    const invalidDirectory = getTasksDir('not-a-directory')
    mkdirSync(dirname(invalidDirectory), { recursive: true })
    writeFileSync(invalidDirectory, 'not a directory')
    await expect(
      inspectTaskListForGate('not-a-directory'),
    ).rejects.toThrow()
  })

  test('returns schema-validated snapshots in numeric task order', async () => {
    writeSnapshot('valid', '10', taskSnapshot('10'))
    writeSnapshot('valid', '2', taskSnapshot('2'))

    const inspection = await inspectTaskListForGate('valid')
    expect(inspection.taskCount).toBe(2)
    expect(inspection.tasks.map(task => task.id)).toEqual(['2', '10'])
  })

  test('surfaces task-file read failures', async () => {
    const dir = getTasksDir('read-failure')
    mkdirSync(join(dir, '1.json'), { recursive: true })

    await expect(
      inspectTaskListForGate('read-failure'),
    ).rejects.toThrow()
  })

  test('surfaces malformed JSON instead of omitting the task', async () => {
    const dir = getTasksDir('bad-json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '1.json'), '{"id":')

    await expect(inspectTaskListForGate('bad-json')).rejects.toThrow()
  })

  test('surfaces schema-invalid task snapshots', async () => {
    writeSnapshot('bad-schema', '1', {
      ...taskSnapshot('1'),
      status: 'invented-status',
    })

    await expect(
      inspectTaskListForGate('bad-schema'),
    ).rejects.toThrow()
  })

  test('surfaces filename and embedded task-id mismatches', async () => {
    writeSnapshot('mismatched-id', '1', taskSnapshot('2'))

    await expect(
      inspectTaskListForGate('mismatched-id'),
    ).rejects.toThrow('mismatched task id')
  })

  test('preserves forgiving listTasks behavior for UI callers', async () => {
    writeSnapshot('forgiving-ui', '1', taskSnapshot('1'))
    writeSnapshot('forgiving-ui', '2', {
      ...taskSnapshot('2'),
      status: 'invented-status',
    })

    await expect(listTasks('forgiving-ui')).resolves.toMatchObject([
      { id: '1' },
    ])
    await expect(
      inspectTaskListForGate('forgiving-ui'),
    ).rejects.toThrow()
  })
})
