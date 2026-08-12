import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkTaskListGate } from '../src/services/tools/taskListGate.ts'
import {
  derivePlanTaskBlueprints,
  ensureApprovedPlanTasks,
} from '../src/tools/ExitPlanModeTool/planTaskSync.ts'
import { listTasks } from '../src/utils/tasks.ts'

let configRoot = ''
let previousConfigDir: string | undefined
let previousTaskListId: string | undefined
const taskListId = 'plan-mode-task-sync-regression'

function toolContext() {
  let appState = { expandedView: undefined as string | undefined }
  return {
    abortController: new AbortController(),
    options: { tools: [] },
    messages: [],
    getAppState() {
      return appState
    },
    setAppState(update: (previous: typeof appState) => typeof appState) {
      appState = update(appState)
    },
  } as never
}

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), 'ur-plan-task-sync-'))
  previousConfigDir = process.env.UR_CONFIG_DIR
  previousTaskListId = process.env.UR_CODE_TASK_LIST_ID
  process.env.UR_CONFIG_DIR = configRoot
  process.env.UR_CODE_TASK_LIST_ID = taskListId
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.UR_CONFIG_DIR
  else process.env.UR_CONFIG_DIR = previousConfigDir
  if (previousTaskListId === undefined) delete process.env.UR_CODE_TASK_LIST_ID
  else process.env.UR_CODE_TASK_LIST_ID = previousTaskListId
  rmSync(configRoot, { recursive: true, force: true })
})

test('approved plan steps become professional implementation and verification tasks', () => {
  const tasks = derivePlanTaskBlueprints(`# Context
- The old workflow can deadlock.

## Implementation
- Allow only the current plan file through the task gate.
- Synchronize approved plan steps into visible tasks.
- Synchronize approved plan steps into visible tasks.

## Verification
- Test the plan-to-implementation transition end to end.
`)

  expect(tasks.map(task => task.subject)).toEqual([
    'Allow only the current plan file through the task gate',
    'Synchronize approved plan steps into visible tasks',
    'Test the plan-to-implementation transition end to end',
  ])
  expect(tasks.some(task => task.subject.includes('old workflow'))).toBe(false)
})

test('plan approval creates a visible board before the first project mutation', async () => {
  const taskIds = await ensureApprovedPlanTasks(
    `## Implementation
1. Update the task gate for plan artifacts.
2. Add approved-plan task synchronization.

## Verification
- Verify the exact transition with regression tests.`,
    '/tmp/session-plan.md',
    toolContext(),
  )
  const tasks = await listTasks(taskListId)

  expect(taskIds).toHaveLength(3)
  expect(tasks.map(task => task.subject)).toEqual([
    'Update the task gate for plan artifacts',
    'Add approved-plan task synchronization',
    'Verify the exact transition with regression tests',
  ])
  expect(tasks[2]?.blockedBy).toEqual(taskIds.slice(0, 2))
  expect(tasks.every(task => task.metadata?.source === 'approved-plan')).toBe(
    true,
  )
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: tasks.length,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: true,
      requiresTaskList: true,
      config: { enabled: true, freeReads: 3 },
    }).allowed,
  ).toBe(true)
})

test('approval preserves an existing actionable task list without duplicates', async () => {
  await ensureApprovedPlanTasks(
    '## Implementation\n- Implement the first approved plan.',
    '/tmp/first-plan.md',
    toolContext(),
  )
  const before = await listTasks(taskListId)
  const created = await ensureApprovedPlanTasks(
    '## Implementation\n- Implement a duplicate plan.',
    '/tmp/second-plan.md',
    toolContext(),
  )

  expect(created).toEqual([])
  expect(await listTasks(taskListId)).toEqual(before)
})

test('a verification-only plan still receives a separate implementation task', () => {
  expect(
    derivePlanTaskBlueprints(
      '## Verification\n- Run the full test suite and check the build.',
    ).map(task => task.subject),
  ).toEqual([
    'Implement the approved plan',
    'Run the full test suite and check the build',
  ])
})
