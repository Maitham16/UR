import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppState } from '../src/state/AppState.js'
import {
  createTaskStateBase,
  isLegacyPersistedTaskType,
  LEGACY_PERSISTED_TASK_TYPES,
  RUNTIME_TASK_TYPES,
} from '../src/Task.js'
import { InProcessTeammateTask } from '../src/tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import type { InProcessTeammateTaskState } from '../src/tasks/InProcessTeammateTask/types.js'
import type { LocalWorkflowTaskState } from '../src/tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { MonitorMcpTaskState } from '../src/tasks/MonitorMcpTask/MonitorMcpTask.js'
import { stopTask, StopTaskError } from '../src/tasks/stopTask.js'
import { getAllTasks, getTaskByType } from '../src/tasks.js'
import {
  isBackgroundTask,
  type TaskState,
} from '../src/tasks/types.js'

let configRoot = ''
let previousConfigDir: string | undefined

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), 'ur-runtime-task-registry-'))
  previousConfigDir = process.env.UR_CONFIG_DIR
  process.env.UR_CONFIG_DIR = configRoot
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.UR_CONFIG_DIR
  else process.env.UR_CONFIG_DIR = previousConfigDir
  rmSync(configRoot, { recursive: true, force: true })
})

function stateHarness(task: TaskState, extra: Record<string, unknown> = {}) {
  let state = {
    tasks: { [task.id]: task },
    ...extra,
  } as unknown as AppState

  return {
    get state() {
      return state
    },
    context: {
      getAppState: () => state,
      setAppState: (update: (previous: AppState) => AppState) => {
        state = update(state)
      },
    },
  }
}

describe('runtime task registry', () => {
  test('contains exactly one lifecycle implementation for every creatable task type', () => {
    const tasks = getAllTasks()
    const registeredTypes = tasks.map(task => task.type)

    expect(registeredTypes).toEqual([...RUNTIME_TASK_TYPES])
    expect(new Set(registeredTypes).size).toBe(registeredTypes.length)

    for (const type of RUNTIME_TASK_TYPES) {
      expect(getTaskByType(type)?.type).toBe(type)
    }
    for (const type of LEGACY_PERSISTED_TASK_TYPES) {
      expect(getTaskByType(type)).toBeUndefined()
    }
  })

  test('TaskStop dispatches through the in-process teammate lifecycle', async () => {
    const taskId = 'tteammate1'
    const agentId = 'reviewer@registry-test'
    const abortController = new AbortController()
    let cleanupCalls = 0
    let idleCallbackCalls = 0

    const teammate: InProcessTeammateTaskState = {
      ...createTaskStateBase(
        taskId,
        'in_process_teammate',
        'review the registry',
        'tool-1',
      ),
      type: 'in_process_teammate',
      status: 'running',
      identity: {
        agentId,
        agentName: 'reviewer',
        teamName: 'registry-test',
        planModeRequired: false,
        parentSessionId: 'session-1',
      },
      prompt: 'review the registry',
      abortController,
      unregisterCleanup: () => {
        cleanupCalls += 1
      },
      awaitingPlanApproval: false,
      permissionMode: 'default',
      pendingUserMessages: [],
      isIdle: true,
      shutdownRequested: false,
      onIdleCallbacks: [
        () => {
          idleCallbackCalls += 1
        },
      ],
      lastReportedToolCount: 0,
      lastReportedTokenCount: 0,
    }
    const harness = stateHarness(teammate, {
      teamContext: {
        teammates: {
          [agentId]: { agentId },
        },
      },
    })

    // The production lifecycle retains a killed row briefly for the TUI.
    // Suppress that delayed eviction so this unit test can inspect the
    // immediate terminal state without leaving a timer behind.
    const suppressDelayedEviction =
      (() => 0 as never) as unknown as typeof setTimeout
    const timeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(
      suppressDelayedEviction,
    )
    try {
      const result = await stopTask(taskId, harness.context)

      expect(result).toEqual({
        taskId,
        taskType: 'in_process_teammate',
        command: 'review the registry',
      })
      expect(abortController.signal.aborted).toBe(true)
      expect(cleanupCalls).toBe(1)
      expect(idleCallbackCalls).toBe(1)
      expect(harness.state.tasks[taskId]).toMatchObject({
        status: 'killed',
        notified: true,
      })
      expect(
        (harness.state as unknown as {
          teamContext: { teammates: Record<string, unknown> }
        }).teamContext.teammates[agentId],
      ).toBeUndefined()
      expect(getTaskByType('in_process_teammate')).toBe(
        InProcessTeammateTask,
      )
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  for (const type of LEGACY_PERSISTED_TASK_TYPES) {
    test(`keeps historical ${type} state inspectable but explicitly non-stoppable`, async () => {
      const taskId = type === 'local_workflow' ? 'wlegacy01' : 'mlegacy01'
      const base = {
        id: taskId,
        type,
        status: 'running' as const,
        description: `historical ${type}`,
        startTime: 1,
        outputFile: join(configRoot, `${taskId}.output`),
        outputOffset: 0,
        notified: false,
        isBackgrounded: true,
      }
      const historical: LocalWorkflowTaskState | MonitorMcpTaskState =
        type === 'local_workflow'
          ? { ...base, type: 'local_workflow' }
          : { ...base, type: 'monitor_mcp' }
      const task: TaskState = historical
      const harness = stateHarness(task)

      expect(isLegacyPersistedTaskType(task.type)).toBe(true)
      expect(isBackgroundTask(task)).toBe(true)

      let error: unknown
      try {
        await stopTask(taskId, harness.context)
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(StopTaskError)
      expect(error).toMatchObject({
        code: 'unsupported_type',
        message: `Persisted legacy task type ${type} has no runtime lifecycle implementation`,
      })
      expect(harness.state.tasks[taskId]).toEqual(task)
    })
  }
})
