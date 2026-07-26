import { expect, test } from 'bun:test'
import {
  evaluateEvalGate,
  runSuite,
  type EvalReport,
  type EvalSuite,
} from '../src/services/agents/evals.ts'
import {
  captureTrajectory,
  gradeCapturedTrajectory,
  MAX_TRAJECTORY_EVENTS,
  parseStreamJsonTrajectory,
} from '../src/services/agents/trajectory.ts'

test('stream-json capture keeps structure but drops prompts, inputs, and results', () => {
  const secret = 'sensitive-' + 'value'
  const lines = [
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'call-private-id',
            name: 'FileRead',
            input: { path: `/private/${secret}` },
          },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-private-id',
            content: secret,
          },
        ],
      },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 1,
      result: 'done',
      permission_denials: [],
    },
  ]
  const parsed = parseStreamJsonTrajectory(
    lines.map(line => JSON.stringify(line)).join('\n'),
  )
  expect(parsed.output).toBe('done')
  expect(parsed.trajectory.tools).toEqual(['Read'])
  expect(parsed.trajectory.failedToolCalls).toBe(0)
  expect(JSON.stringify(parsed.trajectory)).not.toContain(secret)
  expect(JSON.stringify(parsed.trajectory)).not.toContain('call-private-id')
})

test('authoritative result turns override per-content-block envelopes', () => {
  const trajectory = captureTrajectory([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking' }] } },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'one', name: 'FileRead' }] },
    },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 1,
      permission_denials: [],
    },
  ])
  expect(trajectory.turns).toBe(1)
  expect(gradeCapturedTrajectory(trajectory, { maxTurns: 1 }).passed).toBe(true)
})

test('rich trajectory rules grade success, failure, repetitions, and denials', () => {
  const trajectory = captureTrajectory([
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: '1', name: 'Grep' },
          { type: 'tool_use', id: '2', name: 'Edit' },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: '1', is_error: false },
          { type: 'tool_result', tool_use_id: '2', is_error: false },
        ],
      },
    },
  ])
  const grade = gradeCapturedTrajectory(trajectory, {
    requiredTools: ['Grep', 'Edit'],
    forbiddenTools: ['Bash'],
    orderedTools: ['Grep', 'Edit'],
    requireSuccessfulTools: ['Edit'],
    maxToolCalls: 2,
    maxFailedToolCalls: 0,
    maxPermissionDenials: 0,
  })
  expect(grade.passed).toBe(true)
  expect(grade.score).toBe(1)
})

test('trajectory grading fails closed when the event cap omits a forbidden tail', () => {
  const trajectory = captureTrajectory([
    {
      type: 'assistant',
      message: {
        content: [
          ...Array.from({ length: MAX_TRAJECTORY_EVENTS }, (_, index) => ({
            type: 'tool_use',
            id: `safe-${index}`,
            name: 'Read',
          })),
          { type: 'tool_use', id: 'omitted-tail', name: 'Bash' },
        ],
      },
    },
  ])
  const grade = gradeCapturedTrajectory(trajectory, {
    forbiddenTools: ['Bash'],
  })
  expect(trajectory.truncated).toBe(true)
  expect(grade.passed).toBe(false)
  expect(
    grade.checks.find(check => check.name === 'trajectory capture complete'),
  ).toMatchObject({ passed: false })
})

test('trajectory grading fails closed on malformed stream lines', () => {
  const parsed = parseStreamJsonTrajectory(
    [
      '{"type":"assistant","message":{"content":[]}}',
      '{"type":',
      '{"type":"result","subtype":"success","is_error":false,"num_turns":1}',
    ].join('\n'),
  )
  const grade = gradeCapturedTrajectory(parsed.trajectory, { maxTurns: 1 })
  expect(parsed.trajectory.malformedLines).toBe(1)
  expect(grade.passed).toBe(false)
  expect(
    grade.checks.find(check => check.name === 'trajectory capture complete'),
  ).toMatchObject({ passed: false })
})

test('suite persists normalized trajectory score and eval gate fails closed', async () => {
  const suite: EvalSuite = {
    version: 1,
    name: 'trajectory-scoring',
    cases: [
      {
        id: 'case',
        category: 'coding',
        prompt: 'work',
        expect: {
          trajectory: {
            requiredTools: ['Read', 'Edit'],
            maxToolCalls: 2,
          },
        },
      },
    ],
  }
  const report = await runSuite(suite, async () => ({
    output: 'done',
    trajectory: ['Read'],
  }))
  expect(report.trajectoryScore).toBeCloseTo(3 / 4)
  expect(report.totalCostUSD).toBeUndefined()
  const gate = evaluateEvalGate(report, {
    minPassRate: 1,
    minTrajectoryScore: 0.9,
  })
  expect(gate.passed).toBe(false)

  const withoutMetric = {
    ...report,
    passRate: 1,
    trajectoryScore: undefined,
  } as EvalReport
  expect(
    evaluateEvalGate(withoutMetric, { minTrajectoryScore: 0.5 }).passed,
  ).toBe(false)
  expect(evaluateEvalGate(report, { maxCostUSD: 1 }).passed).toBe(false)
})
