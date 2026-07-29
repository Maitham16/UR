import { describe, expect, test } from 'bun:test'
import {
  localCommandExitCode,
  type LocalCommandResult,
} from '../src/types/command.js'

describe('local command exit status', () => {
  test('honors an explicit command result without global process mutation', () => {
    const result: LocalCommandResult = {
      type: 'text',
      value: 'failed',
      exitCode: 2,
    }
    expect(localCommandExitCode(result, 0)).toBe(2)
  })

  test('uses the adapter fallback when a command has no explicit status', () => {
    expect(localCommandExitCode({ type: 'skip' }, 7)).toBe(7)
  })

  test('fails closed for invalid process exit codes', () => {
    expect(
      localCommandExitCode({
        type: 'text',
        value: 'invalid',
        exitCode: 999,
      }),
    ).toBe(1)
  })
})
