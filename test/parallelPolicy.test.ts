import { describe, expect, test } from 'bun:test'
import {
  isClearlyReadOnlyWork,
  isDelegationConcurrencySafe,
} from '../src/services/agents/parallelPolicy.js'

describe('parallel agent policy', () => {
  test('parallelizes bounded read-only work', () => {
    expect(isClearlyReadOnlyWork('Inspect the parser and report findings')).toBe(
      true,
    )
    expect(
      isClearlyReadOnlyWork(
        'Read-only audit. Report recommended implementation. Do not edit files.',
      ),
    ).toBe(true)
  })

  test('serializes unknown and shared-checkout mutations', () => {
    expect(isClearlyReadOnlyWork('Implement the parser')).toBe(false)
    expect(isClearlyReadOnlyWork('Handle the parser task')).toBe(false)
    expect(
      isDelegationConcurrencySafe({ prompt: 'Implement the parser' }),
    ).toBe(false)
  })

  test('allows a mutating branch only with explicit isolation', () => {
    expect(
      isDelegationConcurrencySafe({
        prompt: 'Implement the parser',
        isolation: 'worktree',
      }),
    ).toBe(true)
  })
})
