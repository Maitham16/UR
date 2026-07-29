import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearRegisteredPluginHooks,
  getRegisteredHooks,
  isReplBridgeActive,
  registerHookCallbacks,
  resetStateForTests,
  setReplBridgeActive,
} from '../src/bootstrap/state.js'
import type { HookEvent } from '../src/entrypoints/agentSdkTypes.js'

afterEach(() => {
  resetStateForTests()
})

describe('bootstrap state safety', () => {
  test('tracks interactive bridge state and resets it between sessions', () => {
    expect(isReplBridgeActive()).toBe(false)
    setReplBridgeActive(true)
    expect(isReplBridgeActive()).toBe(true)

    resetStateForTests()
    expect(isReplBridgeActive()).toBe(false)
  })

  test('ignores empty partial hook entries instead of throwing', () => {
    registerHookCallbacks({
      PreToolUse: undefined,
    } as Partial<Record<HookEvent, never[]>>)

    expect(getRegisteredHooks()).toEqual({})
    expect(() => clearRegisteredPluginHooks()).not.toThrow()
  })

  test('the REPL bridge publishes interactive state and clears it on teardown', () => {
    const hook = readFileSync(
      join(import.meta.dir, '..', 'src', 'hooks', 'useReplBridge.tsx'),
      'utf8',
    )

    expect(hook).toContain('setReplBridgeActive(!outboundOnly)')
    expect(hook).toContain('setReplBridgeActive(false)')
  })
})
