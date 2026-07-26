import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { Server, ServerResponse } from 'node:http'
import { AuthCodeListener } from '../src/services/oauth/auth-code-listener.js'
import { OAuthService } from '../src/services/oauth/index.js'

function testListener(): AuthCodeListener {
  const listener = new AuthCodeListener()
  const server = new EventEmitter() as Server
  server.close = (() => server) as Server['close']
  Object.assign(listener, { localServer: server })
  return listener
}

function testResponse(): {
  response: ServerResponse
  result: { status: number; body: string }
} {
  const result = { status: 0, body: '' }
  const response = {
    writeHead(status: number) {
      result.status = status
      return response
    },
    end(body = '') {
      result.body = String(body)
      return response
    },
  } as unknown as ServerResponse
  return { response, result }
}

function submitCallback(
  listener: AuthCodeListener,
  code: string | undefined,
  state: string | undefined,
  response: ServerResponse,
): void {
  const internal = listener as unknown as {
    validateAndRespond(
      authCode: string | undefined,
      callbackState: string | undefined,
      callbackResponse: ServerResponse,
    ): void
  }
  internal.validateAndRespond(code, state, response)
}

describe('OAuth callback handling', () => {
  test('ignores an invalid callback and still accepts the expected state', async () => {
    const listener = testListener()
    try {
      const authorization = listener.waitForAuthorization(
        'expected-state',
        async () => {},
      )
      let settled = false
      void authorization.finally(() => {
        settled = true
      })

      const invalid = testResponse()
      submitCallback(listener, 'attacker', 'wrong', invalid.response)
      expect(invalid.result).toEqual({
        status: 400,
        body: 'Invalid state parameter',
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      const browser = testResponse()
      submitCallback(
        listener,
        'valid-code',
        'expected-state',
        browser.response,
      )
      expect(await authorization).toBe('valid-code')
      listener.handleSuccessRedirect([], response => {
        response.writeHead(200)
        response.end('complete')
      })
      expect(browser.result).toEqual({ status: 200, body: 'complete' })
    } finally {
      listener.close()
    }
  })

  test('rejects when preparing the browser flow fails', async () => {
    const listener = testListener()
    try {
      await expect(
        listener.waitForAuthorization('expected-state', async () => {
          throw new Error('browser launch failed')
        }),
      ).rejects.toThrow('browser launch failed')
    } finally {
      listener.close()
    }
  })

  test('validates the state supplied by the manual callback', () => {
    const service = new OAuthService()
    let resolved = ''
    Object.assign(service, {
      expectedState: 'expected-state',
      manualAuthCodeResolver: (code: string) => {
        resolved = code
      },
    })

    expect(() =>
      service.handleManualAuthCodeInput({
        authorizationCode: 'wrong-code',
        state: 'wrong-state',
      }),
    ).toThrow('Invalid OAuth state')
    expect(resolved).toBe('')

    service.handleManualAuthCodeInput({
      authorizationCode: 'valid-code',
      state: 'expected-state',
    })
    expect(resolved).toBe('valid-code')
  })
})
