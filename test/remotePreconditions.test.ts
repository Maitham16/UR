import { describe, expect, test } from 'bun:test'
import { checkNeedsURAiLogin } from '../src/utils/background/remote/preconditions.js'

describe('remote session login precondition', () => {
  test('requires login when there is no subscriber session', async () => {
    let refreshCalls = 0
    expect(
      await checkNeedsURAiLogin({
        isSubscriber: () => false,
        refreshTokenIfNeeded: async () => {
          refreshCalls++
          return false
        },
        getTokens: () => null,
      }),
    ).toBe(true)
    expect(refreshCalls).toBe(0)
  })

  test('accepts a current access token without requiring a refresh', async () => {
    expect(
      await checkNeedsURAiLogin({
        isSubscriber: () => true,
        refreshTokenIfNeeded: async () => false,
        getTokens: () => ({
          accessToken: 'valid',
          expiresAt: Date.now() + 60 * 60_000,
        }),
      }),
    ).toBe(false)
  })

  test('requires login when an expired token cannot be refreshed', async () => {
    expect(
      await checkNeedsURAiLogin({
        isSubscriber: () => true,
        refreshTokenIfNeeded: async () => false,
        getTokens: () => ({
          accessToken: 'expired',
          expiresAt: Date.now() - 1,
        }),
      }),
    ).toBe(true)
  })

  test('does not invert a successful refresh into a login error', async () => {
    let accessToken = 'expired'
    let expiresAt = Date.now() - 1
    expect(
      await checkNeedsURAiLogin({
        isSubscriber: () => true,
        refreshTokenIfNeeded: async () => {
          accessToken = 'refreshed'
          expiresAt = Date.now() + 60 * 60_000
          return true
        },
        getTokens: () => ({ accessToken, expiresAt }),
      }),
    ).toBe(false)
  })
})
