import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { SDKControlResponse } from '../src/entrypoints/sdk/controlTypes.js'
import {
  buildSessionsWebSocketUrl,
  MAX_QUEUED_CONTROL_RESPONSE_BYTES,
  SessionsWebSocket,
  type SessionsWebSocketOptions,
} from '../src/remote/SessionsWebSocket.js'
import {
  clearOllamaBaseUrlOverride,
  setOllamaBaseUrlOverride,
} from '../src/utils/model/ollamaConfig.js'

type Listener = (event: any) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static constructionFailures = 0

  readonly listeners = new Map<string, Listener[]>()
  readonly url: string
  readonly sent: string[] = []
  closeCalls = 0

  constructor(url: string, _options?: unknown) {
    if (FakeWebSocket.constructionFailures > 0) {
      FakeWebSocket.constructionFailures--
      throw new Error('constructor failed')
    }
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  emit(event: string, value: unknown = {}): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }

  close(): void {
    this.closeCalls++
  }

  send(data: string): void {
    this.sent.push(data)
  }
  ping(): void {}
}

function createReconnectScheduler() {
  let nextId = 1
  const pending = new Map<
    NodeJS.Timeout,
    { callback: () => void; delayMs: number }
  >()

  const options: SessionsWebSocketOptions = {
    scheduleReconnect: (callback, delayMs) => {
      const token = { id: nextId++ } as unknown as NodeJS.Timeout
      pending.set(token, { callback, delayMs })
      return token
    },
    clearReconnect: timer => {
      pending.delete(timer)
    },
  }

  return {
    options,
    pending: () => [...pending.values()],
    runNext: () => {
      const next = pending.entries().next().value
      if (!next) throw new Error('No reconnect was scheduled')
      const [token, entry] = next
      pending.delete(token)
      entry.callback()
    },
  }
}

const originalWebSocket = globalThis.WebSocket
let activeClient: SessionsWebSocket | undefined

function permissionResponse(requestId: string): SDKControlResponse {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: { behavior: 'allow', updatedInput: {} },
    },
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  FakeWebSocket.constructionFailures = 0
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  setOllamaBaseUrlOverride('http://localhost:11434')
})

afterEach(() => {
  activeClient?.close()
  activeClient = undefined
  globalThis.WebSocket = originalWebSocket
  clearOllamaBaseUrlOverride()
})

describe('SessionsWebSocket reliability', () => {
  test('converts HTTP protocols and preserves an optional base path', () => {
    expect(
      buildSessionsWebSocketUrl(
        'http://localhost:8000/',
        'session/with space',
        'org id/one',
      ),
    ).toBe(
      'ws://localhost:8000/v1/sessions/ws/session%2Fwith%20space/subscribe?organization_uuid=org+id%2Fone',
    )
    expect(
      buildSessionsWebSocketUrl(
        'https://api.example.test/base/',
        'session-123',
        'org-456',
      ),
    ).toBe(
      'wss://api.example.test/base/v1/sessions/ws/session-123/subscribe?organization_uuid=org-456',
    )
  })

  test('retries when the initial handshake closes before opening', async () => {
    const scheduler = createReconnectScheduler()
    let reconnecting = 0
    let permanentlyClosed = 0
    activeClient = new SessionsWebSocket(
      'session-123',
      'org-456',
      () => 'access-token',
      {
        onMessage: () => {},
        onReconnecting: () => reconnecting++,
        onClose: () => permanentlyClosed++,
      },
      scheduler.options,
    )

    await activeClient.connect()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0]!.url).toStartWith('ws://localhost:11434/')

    FakeWebSocket.instances[0]!.emit('close', {
      code: 1006,
      reason: 'connection refused',
    })

    expect(reconnecting).toBe(1)
    expect(permanentlyClosed).toBe(0)
    expect(scheduler.pending()).toHaveLength(1)
    expect(scheduler.pending()[0]!.delayMs).toBe(2_000)

    scheduler.runNext()
    await Promise.resolve()
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  test('turns synchronous setup failure into a bounded reconnect', async () => {
    const scheduler = createReconnectScheduler()
    const errors: Error[] = []
    let reconnecting = 0
    let connected = 0
    FakeWebSocket.constructionFailures = 1
    activeClient = new SessionsWebSocket(
      'session-123',
      'org-456',
      () => 'access-token',
      {
        onMessage: () => {},
        onError: error => errors.push(error),
        onReconnecting: () => reconnecting++,
        onConnected: () => connected++,
      },
      scheduler.options,
    )

    await expect(activeClient.connect()).resolves.toBeUndefined()
    expect(errors.map(error => error.message)).toEqual(['constructor failed'])
    expect(reconnecting).toBe(1)
    expect(scheduler.pending()).toHaveLength(1)

    scheduler.runNext()
    await Promise.resolve()
    expect(FakeWebSocket.instances).toHaveLength(1)

    FakeWebSocket.instances[0]!.emit('open')
    expect(activeClient.isConnected()).toBe(true)
    expect(connected).toBe(1)
  })

  test('queues one permission response during reconnect and flushes it once', async () => {
    const scheduler = createReconnectScheduler()
    activeClient = new SessionsWebSocket(
      'session-123',
      'org-456',
      () => 'access-token',
      { onMessage: () => {} },
      scheduler.options,
    )

    await activeClient.connect()
    FakeWebSocket.instances[0]!.emit('open')
    FakeWebSocket.instances[0]!.emit('close', {
      code: 1006,
      reason: 'transient disconnect',
    })

    const response = permissionResponse('request-123')
    expect(activeClient.sendControlResponse(response)).toBe(true)
    // A duplicate decision for the same request replaces the queued value
    // rather than replaying the response twice.
    expect(activeClient.sendControlResponse(response)).toBe(true)
    expect(FakeWebSocket.instances[0]!.sent).toHaveLength(0)

    scheduler.runNext()
    await Promise.resolve()
    FakeWebSocket.instances[1]!.emit('open')

    expect(FakeWebSocket.instances[1]!.sent).toHaveLength(1)
    expect(JSON.parse(FakeWebSocket.instances[1]!.sent[0]!)).toEqual(response)
  })

  test('explicit close discards queued responses and prevents replay', async () => {
    const scheduler = createReconnectScheduler()
    activeClient = new SessionsWebSocket(
      'session-123',
      'org-456',
      () => 'access-token',
      { onMessage: () => {} },
      scheduler.options,
    )
    const response = permissionResponse('request-to-discard')

    await activeClient.connect()
    expect(activeClient.sendControlResponse(response)).toBe(true)
    activeClient.close()
    expect(activeClient.sendControlResponse(response)).toBe(false)

    await activeClient.connect()
    FakeWebSocket.instances[1]!.emit('open')
    expect(FakeWebSocket.instances[1]!.sent).toHaveLength(0)
  })

  test('rejects control responses that exceed the total reconnect queue budget', async () => {
    const scheduler = createReconnectScheduler()
    activeClient = new SessionsWebSocket(
      'session-123',
      'org-456',
      () => 'access-token',
      { onMessage: () => {} },
      scheduler.options,
    )
    const oversized = permissionResponse('request-oversized')
    ;(oversized.response as any).response.updatedInput = {
      content: 'x'.repeat(MAX_QUEUED_CONTROL_RESPONSE_BYTES),
    }

    await activeClient.connect()
    expect(activeClient.sendControlResponse(oversized)).toBe(false)

    const small = permissionResponse('request-oversized')
    expect(activeClient.sendControlResponse(small)).toBe(true)
    FakeWebSocket.instances[0]!.emit('open')
    expect(FakeWebSocket.instances[0]!.sent).toHaveLength(1)
    expect(JSON.parse(FakeWebSocket.instances[0]!.sent[0]!)).toEqual(small)
  })
})
