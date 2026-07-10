import { afterEach, describe, expect, test } from 'bun:test'
import { DirectConnectSessionManager } from '../src/server/directConnectManager.ts'

type Listener = (...args: any[]) => void

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  private listeners = new Map<string, Listener[]>()

  constructor(_url: string, _options?: unknown) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  send(data: string): void { this.sent.push(data) }
  close(): void { this.emit('close') }
  open(): void { this.readyState = FakeWebSocket.OPEN; this.emit('open') }
  emit(event: string, value?: unknown): void { for (const listener of this.listeners.get(event) ?? []) listener(value) }
}

const OriginalWebSocket = globalThis.WebSocket

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket
  FakeWebSocket.instances = []
})

describe('DirectConnectSessionManager', () => {
  test('intentional disconnect does not report a fatal remote disconnect', () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    let disconnected = 0
    const manager = new DirectConnectSessionManager(
      { serverUrl: 'http://local', sessionId: 's', wsUrl: 'ws://local' },
      { onMessage: () => {}, onPermissionRequest: () => {}, onDisconnected: () => disconnected++ },
    )
    manager.connect()
    FakeWebSocket.instances[0]!.open()
    manager.disconnect()
    expect(disconnected).toBe(0)
    expect(manager.isConnected()).toBe(false)
  })

  test('unexpected close still notifies the caller', () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    let disconnected = 0
    const manager = new DirectConnectSessionManager(
      { serverUrl: 'http://local', sessionId: 's', wsUrl: 'ws://local' },
      { onMessage: () => {}, onPermissionRequest: () => {}, onDisconnected: () => disconnected++ },
    )
    manager.connect()
    const socket = FakeWebSocket.instances[0]!
    socket.open()
    socket.emit('close')
    expect(disconnected).toBe(1)
  })
})
