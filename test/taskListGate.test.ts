import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  TASK_LIST_GATE_DEFAULTS,
  checkTaskListGate,
  countActionableTasksForGate,
  countActionableTodosForGate,
  isMutatingTool,
  isPlanArtifactMutationForGate,
} from '../src/services/tools/taskListGate.ts'
import { AgentTool } from '../src/tools/AgentTool/AgentTool.tsx'
import { countToolCallsBeforeCurrent } from '../src/services/tools/toolExecution.ts'

// The system prompt already asked for a task list on multi-step work and the
// agent still edited files, ran commands and reported completion with no plan
// on record. Guidance does not hold; this is a gate.

const CONFIG = { enabled: true, freeReads: 3 }

test('a mutating call with no task list is refused', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: 0,
    readsSoFar: 10,
    isSubagent: false,
    config: CONFIG,
  })
  expect(decision.allowed).toBe(false)
  // The refusal has to say what to do, or it is just an obstacle.
  expect((decision as { reason: string }).reason).toContain('TaskCreate')
  expect((decision as { reason: string }).reason).toContain(
    'tasks.requireBeforeChanges',
  )
  expect((decision as { reason: string }).reason).toContain(
    'one task per cohesive outcome',
  )
  expect((decision as { reason: string }).reason).toContain(
    'observable done check',
  )
  expect((decision as { reason: string }).reason).toContain(
    'genuinely atomic',
  )
})

test('gate recovery names the task tool available in headless mode', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: 0,
    readsSoFar: 3,
    isSubagent: false,
    isMutating: true,
    taskPlanningToolName: 'TodoWrite',
    config: CONFIG,
  })

  expect(decision.allowed).toBe(false)
  expect((decision as { reason: string }).reason).toContain(
    'Call TodoWrite first',
  )
  expect((decision as { reason: string }).reason).not.toContain('TaskCreate')
})

test('reads are never blocked, so it can investigate before planning', () => {
  // Demanding a plan before the agent is allowed to look at anything would
  // produce a worse plan, not a better one.
  for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch']) {
    expect(
      checkTaskListGate({
        toolName: tool,
        taskCount: 0,
        readsSoFar: 99,
        isSubagent: false,
        config: CONFIG,
      }).allowed,
    ).toBe(true)
  }
})

test('an existing task list opens the gate', () => {
  expect(
    checkTaskListGate({
      toolName: 'Edit',
      taskCount: 1,
      readsSoFar: 50,
      isSubagent: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('a trivial one-shot edit is not gated', () => {
  // freeReads exists so a single-step request does not demand ceremony, which
  // is what would train the user to disable this.
  expect(
    checkTaskListGate({
      toolName: 'Edit',
      taskCount: 0,
      readsSoFar: 1,
      isSubagent: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('subagents must be bound to an actionable parent task before mutation', () => {
  const refusal = checkTaskListGate({
    toolName: 'Write',
    taskCount: 0,
    readsSoFar: 0,
    isSubagent: true,
    config: CONFIG,
  })
  expect(refusal.allowed).toBe(false)
  expect((refusal as { reason: string }).reason).toContain(
    'one task per cohesive outcome',
  )
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 1,
      readsSoFar: 0,
      isSubagent: true,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('the gate never blocks the fix for itself', () => {
  // If TaskCreate were gated the agent could never satisfy the requirement.
  for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']) {
    expect(isMutatingTool(tool)).toBe(false)
  }
})

test('the exact current-session plan file is a narrow gate exemption', () => {
  const expectedPlanFile = '/tmp/ur-plans/steady-river.md'
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Write',
      toolInput: { file_path: expectedPlanFile },
      expectedPlanFile,
      isPlanMode: true,
    }),
  ).toBe(true)
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Edit',
      toolInput: { file_path: '/tmp/ur-plans/steady-river.md' },
      expectedPlanFile: '/tmp/ur-plans/../ur-plans/steady-river.md',
      isPlanMode: true,
    }),
  ).toBe(true)

  for (const filePath of [
    '/tmp/ur-plans/steady-river-copy.md',
    '/tmp/ur-plans/steady-river.md/child',
    '/tmp/ur-plans/other-plan.md',
  ]) {
    expect(
      isPlanArtifactMutationForGate({
        toolName: 'Write',
        toolInput: { file_path: filePath },
        expectedPlanFile,
        isPlanMode: true,
      }),
    ).toBe(false)
  }
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Bash',
      toolInput: { file_path: expectedPlanFile },
      expectedPlanFile,
      isPlanMode: true,
    }),
  ).toBe(false)
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Write',
      toolInput: { file_path: expectedPlanFile },
      expectedPlanFile,
      isPlanMode: false,
    }),
  ).toBe(false)

  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: true,
      isPlanArtifactMutation: true,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('runtime tool classification covers dynamic and future mutators', () => {
  expect(
    checkTaskListGate({
      toolName: 'mcp__filesystem__move_file',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
  expect(
    checkTaskListGate({
      toolName: 'Bash',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('terminal and internal tasks do not permanently bypass the gate', () => {
  expect(
    countActionableTasksForGate([
      { status: 'completed' },
      { status: 'failed' },
      { status: 'skipped' },
      { status: 'pending', metadata: { _internal: true } },
    ]),
  ).toBe(0)
  expect(
    countActionableTasksForGate([
      { status: 'completed' },
      { status: 'pending' },
      { status: 'in_progress' },
    ]),
  ).toBe(2)
})

test('headless TodoWrite plans open the same mutation gate as task-v2 plans', () => {
  expect(
    countActionableTodosForGate([
      { status: 'completed' },
      { status: 'pending' },
      { status: 'in_progress' },
    ]),
  ).toBe(2)
  expect(countActionableTodosForGate([])).toBe(0)

  const source = readFileSync('src/services/tools/toolExecution.ts', 'utf8')
  const counter = source.slice(source.indexOf('async function countTasksForGate'))
  expect(counter.slice(0, 900)).toContain('isTodoV2Enabled')
  expect(counter.slice(0, 900)).toContain('countActionableTodosForGate')
})

test('an unreadable task store fails closed for mutations', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: null,
    readsSoFar: 99,
    isSubagent: false,
    isMutating: true,
    config: CONFIG,
  })
  expect(decision.allowed).toBe(false)
  expect((decision as { reason: string }).reason).toContain(
    'could not be read',
  )
})

test('an unreadable task store fails closed even during the free-call allowance', () => {
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: null,
      readsSoFar: 0,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
})

test('delegating to an agent is classified as potentially mutating', () => {
  expect(AgentTool.isReadOnly({} as never)).toBe(false)
  expect(
    checkTaskListGate({
      toolName: 'Agent',
      taskCount: 0,
      readsSoFar: 0,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
})

test('disabling it restores advisory behaviour', () => {
  expect(
    checkTaskListGate({
      toolName: 'Bash',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      config: { enabled: false, freeReads: 0 },
    }).allowed,
  ).toBe(true)
})

test('defaults are on, with room for a trivial request', () => {
  expect(TASK_LIST_GATE_DEFAULTS.enabled).toBe(true)
  expect(TASK_LIST_GATE_DEFAULTS.freeReads).toBeGreaterThan(0)
})

test('the allowance counts tool calls, not conversation length', () => {
  // Shipped counting messages, so any back-and-forth exhausted the allowance
  // and the gate blocked the first Write of a one-file request — the case the
  // allowance exists to let through.
  const source = readFileSync('src/services/tools/toolExecution.ts', 'utf8')
  const call = source.slice(source.indexOf('checkTaskListGate({'))
  expect(call.slice(0, 400)).toContain('countToolCalls')
  expect(call.slice(0, 400)).not.toContain('messages?.length')
})

test('countToolCalls ignores plain conversation', () => {
  const assistantMessage = {
    type: 'assistant',
    message: { id: 'current', content: [] },
  } as never
  expect(
    countToolCallsBeforeCurrent(
      [
        { type: 'user', message: { content: 'hello' } },
        {
          type: 'assistant',
          message: { id: 'earlier', content: [{ type: 'text', text: 'hi' }] },
        },
      ],
      assistantMessage,
      'not-present',
    ),
  ).toBe(0)
})

test('parallel calls in one response consume the allowance by ordinal', () => {
  const blocks = Array.from({ length: 4 }, (_, index) => ({
    type: 'tool_use' as const,
    id: `mutation-${index}`,
    name: 'Write',
    input: {},
  }))
  const assistantMessage = {
    type: 'assistant',
    message: { id: 'current-batch', content: blocks },
  } as never
  const counts = blocks.map(block =>
    countToolCallsBeforeCurrent([], assistantMessage, block.id),
  )
  expect(counts).toEqual([0, 1, 2, 3])
  expect(
    blocks.map(block =>
      countToolCallsBeforeCurrent(
        [assistantMessage],
        assistantMessage,
        block.id,
      ),
    ),
  ).toEqual([0, 1, 2, 3])
  expect(
    counts.map(
      readsSoFar =>
        checkTaskListGate({
          toolName: 'Write',
          taskCount: 0,
          readsSoFar,
          isSubagent: false,
          isMutating: true,
          config: CONFIG,
        }).allowed,
    ),
  ).toEqual([true, true, true, false])
})

test('an unreadable task directory cannot silently open the mutation gate', () => {
  const source = readFileSync(
    'src/services/tools/toolExecution.ts',
    'utf8',
  )
  const start = source.indexOf('async function countTasksForGate')
  const end = source.indexOf('\nfunction getStopHookInfo', start)
  const fn = source.slice(start, end)
  expect(fn).toContain('catch {\n    return null')
  expect(fn).not.toContain('POSITIVE_INFINITY')
})
