import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  TASK_LIST_GATE_DEFAULTS,
  checkTaskListGate,
  isMutatingTool,
} from '../src/services/tools/taskListGate.ts'

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

test('subagents are exempt — they execute a step, not the plan', () => {
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 99,
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
  const source = readFileSync('src/services/tools/toolExecution.ts', 'utf8')
  const fn = source.slice(source.indexOf('function countToolCalls'))
  expect(fn.slice(0, 500)).toContain("=== 'tool_use'")
})

test('an unreadable task directory does not block every tool call', () => {
  // countTasksForGate returns Infinity on failure: a gate that fires because
  // the task store hiccuped would be worse than the problem it solves.
  const source = readFileSync(
    'src/services/tools/toolExecution.ts',
    'utf8',
  )
  const fn = source.slice(source.indexOf('async function countTasksForGate'))
  expect(fn.slice(0, 400)).toContain('POSITIVE_INFINITY')
})
