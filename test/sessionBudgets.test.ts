import { afterEach, describe, expect, it } from 'bun:test'
import {
  getWebSearchBudgetSnapshot,
  recordSubagentSpawn,
  reserveWebSearchBudget,
  resetSessionBudgetsForTests,
} from '../src/utils/sessionBudgets.js'

afterEach(() => {
  delete process.env.UR_MAX_WEB_SEARCHES_PER_SESSION
  delete process.env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION
  delete process.env.UR_SUBAGENT_SPAWN_ADVISORY_PER_SESSION
  resetSessionBudgetsForTests()
})

describe('per-session runaway containment', () => {
  it('atomically reserves web searches and refunds unused capacity', () => {
    process.env.UR_MAX_WEB_SEARCHES_PER_SESSION = '10'
    const first = reserveWebSearchBudget(8, 'session-a' as never)
    const second = reserveWebSearchBudget(8, 'session-a' as never)
    expect(first.granted).toBe(8)
    expect(second.granted).toBe(2)
    expect(getWebSearchBudgetSnapshot('session-a' as never).remaining).toBe(0)

    first.finalize(3)
    second.finalize(2)
    expect(getWebSearchBudgetSnapshot('session-a' as never)).toEqual({
      limit: 10,
      used: 5,
      reserved: 0,
      remaining: 5,
    })
  })

  it('supports the compatibility env name and explicit unlimited sessions', () => {
    process.env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION = '3'
    expect(reserveWebSearchBudget(8, 'compat' as never).granted).toBe(3)
    resetSessionBudgetsForTests()
    process.env.UR_MAX_WEB_SEARCHES_PER_SESSION = 'unlimited'
    expect(reserveWebSearchBudget(8, 'unlimited' as never).granted).toBe(8)
  })

  it('warns about subagent growth without preventing additional spawns', () => {
    process.env.UR_SUBAGENT_SPAWN_ADVISORY_PER_SESSION = '2'
    expect(recordSubagentSpawn('agents' as never)).toEqual({
      count: 1,
      advisoryLimit: 2,
      shouldWarn: false,
    })
    expect(recordSubagentSpawn('agents' as never).shouldWarn).toBe(true)
    expect(recordSubagentSpawn('agents' as never).count).toBe(3)
  })
})
