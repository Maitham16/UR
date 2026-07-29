import { describe, expect, test } from 'bun:test'
import {
  buildExecutionPlan,
  formatExecutionPlan,
  getPattern,
} from '../src/services/agents/patterns.js'
import {
  formatRoute,
  type RouteResult,
} from '../src/services/agents/intentRouter.js'

describe('agent dispatch guidance', () => {
  test('pattern plans expose metadata and an executable runner command', () => {
    const pattern = getPattern('peer')
    expect(pattern).toBeDefined()

    const output = formatExecutionPlan(
      buildExecutionPlan(pattern!, 'audit the provider runtime'),
      false,
    )

    expect(output).toContain('step metadata; this preview does not invoke tools')
    expect(output).toContain('--execute')
    expect(output).not.toContain('Agent({')
    expect(output).not.toContain('Saved as a runnable workflow')
  })

  test('direct routes suggest a real CLI command, not pseudo tool syntax', () => {
    const route: RouteResult = {
      task: 'review the provider runtime',
      category: 'review',
      agent: 'reviewer',
      pattern: null,
      confidence: 0.9,
      complexity: 1,
      rationale: 'review requested',
      scores: [],
    }

    const output = formatRoute(route, false)
    expect(output).toContain(
      'ur --agent reviewer --print "review the provider runtime"',
    )
    expect(output).not.toContain('Agent({')
  })
})
