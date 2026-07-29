import { afterEach, describe, expect, test } from 'bun:test'
import {
  _relayInternalsForTests,
  decodeChunk,
  MAX_CONNECT_HEADER_BYTES,
  MAX_PENDING_BYTES,
} from '../src/upstreamproxy/relay.js'

const originalWebSocket = globalThis.WebSocket

type TestClientSocket = {
  socket: {
    write: (data: Uint8Array | string) => void
    end: () => void
  }
  writes: Buffer[]
  endCalls: () => number
}

function createClientSocket(): TestClientSocket {
  const writes: Buffer[] = []
  let ended = 0
  return {
    socket: {
      write: data => {
        writes.push(
          typeof data === 'string' ? Buffer.from(data) : Buffer.from(data),
        )
      },
      end: () => {
        ended++
      },
    },
    writes,
    endCalls: () => ended,
  }
}

function createWebSocket(readyState: number) {
  const sent: Uint8Array[] = []
  let closeCalls = 0
  return {
    websocket: {
      readyState,
      send: (data: Uint8Array) => sent.push(data),
      close: () => {
        closeCalls++
      },
      binaryType: 'arraybuffer',
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    } as any,
    sent,
    closeCalls: () => closeCalls,
  }
}

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
})

describe('upstream proxy relay hardening', () => {
  test('rejects unterminated and overflowing protobuf length varints', () => {
    expect(decodeChunk(Uint8Array.from([0x0a, 0x80]))).toBeNull()
    expect(
      decodeChunk(Uint8Array.from([0x0a, 0xff, 0xff, 0xff, 0xff, 0x10])),
    ).toBeNull()
  })

  test('forwarding, keepalive, and cleanup work without global WebSocket', () => {
    globalThis.WebSocket = undefined as unknown as typeof WebSocket
    const fake = createWebSocket(1)

    _relayInternalsForTests.forwardToWs(
      fake.websocket,
      Buffer.from('client payload'),
    )
    _relayInternalsForTests.sendKeepalive(fake.websocket)

    const state = _relayInternalsForTests.newConnState()
    state.ws = fake.websocket
    _relayInternalsForTests.cleanupConn(state)

    expect(fake.sent).toHaveLength(2)
    expect(Buffer.from(decodeChunk(fake.sent[0]!)!)).toEqual(
      Buffer.from('client payload'),
    )
    expect(decodeChunk(fake.sent[1]!)).toEqual(new Uint8Array(0))
    expect(fake.closeCalls()).toBe(1)
  })

  test('rejects an oversized CONNECT header even when it is terminated', () => {
    const client = createClientSocket()
    const state = _relayInternalsForTests.newConnState()
    const request = Buffer.from(
      `CONNECT example.com:443 HTTP/1.1\r\nX-Fill: ${'a'.repeat(MAX_CONNECT_HEADER_BYTES)}\r\n\r\n`,
    )

    _relayInternalsForTests.handleData(
      client.socket,
      state,
      request,
      'ws://unused.test',
      'Basic unused',
      'Bearer unused',
    )

    expect(Buffer.concat(client.writes).toString('utf8')).toStartWith(
      'HTTP/1.1 431 Request Header Fields Too Large',
    )
    expect(client.endCalls()).toBe(1)
    expect(state.closed).toBe(true)
    expect(state.connectBuf).toHaveLength(0)
  })

  test('fully closes rejected non-CONNECT clients', () => {
    const client = createClientSocket()
    const state = _relayInternalsForTests.newConnState()

    _relayInternalsForTests.handleData(
      client.socket,
      state,
      Buffer.from('GET http://example.test/ HTTP/1.1\r\n\r\n'),
      'ws://unused.test',
      'Basic unused',
      'Bearer unused',
    )

    expect(Buffer.concat(client.writes).toString('utf8')).toStartWith(
      'HTTP/1.1 405 Method Not Allowed',
    )
    expect(client.endCalls()).toBe(1)
    expect(state.closed).toBe(true)
    expect(state.connectBuf).toHaveLength(0)
  })

  test('turns synchronous WebSocket setup failures into a 502', () => {
    const client = createClientSocket()
    const state = _relayInternalsForTests.newConnState()
    globalThis.WebSocket = class {
      constructor() {
        throw new Error('websocket constructor failed')
      }
    } as unknown as typeof WebSocket

    expect(() =>
      _relayInternalsForTests.handleData(
        client.socket,
        state,
        Buffer.from('CONNECT example.test:443 HTTP/1.1\r\n\r\n'),
        'ws://unused.test',
        'Basic unused',
        'Bearer unused',
      ),
    ).not.toThrow()

    expect(Buffer.concat(client.writes).toString('utf8')).toStartWith(
      'HTTP/1.1 502 Bad Gateway',
    )
    expect(client.endCalls()).toBe(1)
    expect(state.closed).toBe(true)
  })

  test('closes a connection whose pre-open WebSocket queue exceeds its cap', () => {
    const client = createClientSocket()
    const state = _relayInternalsForTests.newConnState()
    const fake = createWebSocket(0)
    state.ws = fake.websocket

    _relayInternalsForTests.handleData(
      client.socket,
      state,
      Buffer.alloc(MAX_PENDING_BYTES),
      'ws://unused.test',
      'Basic unused',
      'Bearer unused',
    )
    expect(state.pendingBytes).toBe(MAX_PENDING_BYTES)
    expect(client.endCalls()).toBe(0)

    _relayInternalsForTests.handleData(
      client.socket,
      state,
      Buffer.from([0]),
      'ws://unused.test',
      'Basic unused',
      'Bearer unused',
    )

    expect(Buffer.concat(client.writes).toString('utf8')).toStartWith(
      'HTTP/1.1 413 Payload Too Large',
    )
    expect(client.endCalls()).toBe(1)
    expect(fake.closeCalls()).toBe(1)
    expect(state.pendingBytes).toBe(0)
    expect(state.pending).toHaveLength(0)
  })
})
