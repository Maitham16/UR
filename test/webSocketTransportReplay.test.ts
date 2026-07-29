import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { StdoutMessage } from '../src/entrypoints/sdk/controlTypes.ts'
import {
  MAX_REPLAY_BUFFER_MESSAGES,
  WebSocketTransport,
} from '../src/cli/transports/WebSocketTransport.ts'

type Listener = (event: any) => void

class FakeBunWebSocket {
  static instances: FakeBunWebSocket[] = []

  readonly listeners = new Map<string, Set<Listener>>()
  readonly sent: string[] = []
  closeCalls = 0

  constructor(
    readonly url: string,
    readonly options?: unknown,
  ) {
    FakeBunWebSocket.instances.push(this)
  }

  addEventListener(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  removeEventListener(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string, value: unknown = {}): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(value)
    }
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalls++
  }

  ping(): void {}
}

function controlRequest(index: number): StdoutMessage {
  return {
    type: 'control_request',
    request_id: `request-${index}`,
    request: {
      subtype: 'can_use_tool',
      tool_name: 'Read',
    },
  }
}

const originalWebSocket = globalThis.WebSocket
let activeTransport: WebSocketTransport | undefined

beforeEach(() => {
  FakeBunWebSocket.instances = []
  globalThis.WebSocket =
    FakeBunWebSocket as unknown as typeof globalThis.WebSocket
})

afterEach(() => {
  activeTransport?.close()
  activeTransport = undefined
  globalThis.WebSocket = originalWebSocket
})

describe('Bun WebSocket replay', () => {
  test('replays pending request_id-only control frames after reconnect', async () => {
    activeTransport = new WebSocketTransport(
      new URL('ws://localhost/session'),
    )

    await activeTransport.connect()
    const firstSocket = FakeBunWebSocket.instances[0]!
    firstSocket.emit('open')
    firstSocket.emit('close', { code: 1006 })

    await activeTransport.write(controlRequest(7))
    expect(firstSocket.sent).toHaveLength(0)

    // Reconnect immediately instead of waiting for the production backoff.
    await activeTransport.connect()
    const reconnectedSocket = FakeBunWebSocket.instances[1]!
    reconnectedSocket.emit('open')

    expect(reconnectedSocket.sent).toHaveLength(1)
    expect(JSON.parse(reconnectedSocket.sent[0]!)).toEqual(controlRequest(7))
  })

  test('bounds replay memory and retains the newest frames on overflow', async () => {
    activeTransport = new WebSocketTransport(
      new URL('ws://localhost/session'),
    )
    await activeTransport.connect()

    for (let index = 0; index <= MAX_REPLAY_BUFFER_MESSAGES; index++) {
      await activeTransport.write(controlRequest(index))
    }

    const socket = FakeBunWebSocket.instances[0]!
    socket.emit('open')

    expect(socket.sent).toHaveLength(MAX_REPLAY_BUFFER_MESSAGES)
    const replayed = socket.sent.map(line => JSON.parse(line))
    expect(replayed[0].request_id).toBe('request-1')
    expect(replayed.at(-1).request_id).toBe(
      `request-${MAX_REPLAY_BUFFER_MESSAGES}`,
    )
    expect(
      replayed.some(message => message.request_id === 'request-0'),
    ).toBe(false)
  })
})
