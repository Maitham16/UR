import { expect, test } from 'bun:test'
import {
  buildDefaultStatusBar,
  countActiveBackgroundTasks,
  countActiveForegroundAgents,
} from '../src/utils/statusBar.ts'

// The status line reported only backgrounded work. isBackgroundTask()
// deliberately excludes foreground entries — it was narrowed to stop stale
// ratios like "tasks: 0/4 active" — but nothing counted them instead, so while
// subagents ran during a turn the bar said nothing at all. That is the one
// moment the count matters.

const running = (type: string, isBackgrounded: boolean) =>
  ({ type, status: 'running', isBackgrounded }) as never

test('a foreground subagent is counted', () => {
  expect(countActiveForegroundAgents([running('local_agent', false)])).toBe(1)
})

test('several foreground agents are counted', () => {
  expect(
    countActiveForegroundAgents([
      running('local_agent', false),
      running('local_agent', false),
      running('remote_agent', false),
    ]),
  ).toBe(3)
})

test('backgrounded agents are not double-counted here', () => {
  // They already appear in the background total. Counting them in both would
  // make the two numbers sum to more than the work actually running.
  const tasks = [running('local_agent', true)]
  expect(countActiveForegroundAgents(tasks)).toBe(0)
  expect(countActiveBackgroundTasks(tasks)).toBe(1)
})

test('a pending foreground agent is not reported as running', () => {
  // It has not started. Reporting it would be an optimistic number, which is
  // the failure mode that makes a status line untrustworthy.
  const pending = { type: 'local_agent', status: 'pending', isBackgrounded: false }
  expect(countActiveForegroundAgents([pending as never])).toBe(0)
})

test('finished agents are not reported as running', () => {
  for (const status of ['completed', 'failed', 'killed']) {
    const done = { type: 'local_agent', status, isBackgrounded: false }
    expect(countActiveForegroundAgents([done as never])).toBe(0)
  }
})

test('non-agent foreground work is not counted as an agent', () => {
  // A running foreground shell is not a subagent; labelling it "agents: 1"
  // would be a wrong number rather than a missing one.
  expect(countActiveForegroundAgents([running('local_bash', false)])).toBe(0)
})

test('the count reaches the rendered status line', () => {
  // Detection that never reaches the screen is the defect being fixed, so
  // assert the rendered string, not just the counter.
  const bar = buildDefaultStatusBar({
    version: '1.0.0',
    model: 'test-model',
    agentRunningCount: 2,
  })
  expect(bar).toContain('agents: 2 running')
})

test('zero agents adds nothing to the bar', () => {
  const bar = buildDefaultStatusBar({
    version: '1.0.0',
    model: 'test-model',
    agentRunningCount: 0,
  })
  expect(bar).not.toContain('agents:')
})

test('agents and background tasks are reported as separate numbers', () => {
  const bar = buildDefaultStatusBar({
    version: '1.0.0',
    model: 'test-model',
    agentRunningCount: 2,
    taskRunningCount: 3,
  })
  expect(bar).toContain('agents: 2 running')
  expect(bar).toContain('tasks: 3 active')
})
