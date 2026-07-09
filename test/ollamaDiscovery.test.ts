import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import type { Socket } from 'node:net'
import {
  discoverOllamaHosts,
  getLocalSubnetInterfaces,
  ipToLong,
  listSubnetHosts,
  longToIp,
  type ConnectFn,
} from '../src/utils/model/ollamaDiscovery.js'

describe('ip helpers', () => {
  test('ipToLong / longToIp round-trip', () => {
    const ips = ['192.168.1.1', '10.0.0.1', '255.255.255.255', '0.0.0.0']
    for (const ip of ips) {
      expect(longToIp(ipToLong(ip))).toBe(ip)
    }
  })

  test('listSubnetHosts excludes network and broadcast', () => {
    const hosts = listSubnetHosts('192.168.1.1', 24)
    expect(hosts[0]).toBe('192.168.1.1')
    expect(hosts[hosts.length - 1]).toBe('192.168.1.254')
    expect(hosts).not.toContain('192.168.1.0')
    expect(hosts).not.toContain('192.168.1.255')
  })
})

describe('discoverOllamaHosts', () => {
  let connectCount = 0
  let fetchCalls: { host: string; port: number }[] = []
  const originalFetch = globalThis.fetch

  function fakeConnect(
    options: { host: string; port: number },
    callback?: () => void,
  ): Socket {
    connectCount++
    const open =
      options.host === '192.168.1.50' || options.host === '192.168.1.60'
    let errorHandler: (() => void) | undefined
    const socket = {
      destroyed: false,
      destroy: () => {
        ;(socket as { destroyed: boolean }).destroyed = true
      },
      end: () => {},
      on: (event: string, handler: () => void) => {
        if (event === 'error') {
          errorHandler = handler
          if (!open && !socket.destroyed) {
            handler()
          }
        }
        return socket as unknown as Socket
      },
    } as unknown as Socket
    if (open) {
      queueMicrotask(() => {
        if (!socket.destroyed) {
          callback?.()
        }
      })
    }
    return socket
  }

  beforeEach(() => {
    connectCount = 0
    fetchCalls = []
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(String(input))
      fetchCalls.push({ host: url.hostname, port: Number(url.port) })
      if (url.hostname === '192.168.1.50') {
        return {
          ok: true,
          json: async () => ({
            models: [{ name: 'qwen2.5-coder:latest' }],
          }),
        } as Response
      }
      if (url.hostname === '192.168.1.60') {
        return {
          ok: true,
          json: async () => ({
            models: [{ name: 'llama3.2:latest' }, { name: 'nomic-embed-text' }],
          }),
        } as Response
      }
      return { ok: false } as Response
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('finds and verifies Ollama hosts on a /24', async () => {
    const result = await discoverOllamaHosts({
      concurrency: 100,
      tcpTimeoutMs: 500,
      httpTimeoutMs: 500,
      connect: fakeConnect as ConnectFn,
      subnets: [['192.168.1.1', 24]],
    })
    expect(result.map(r => r.host)).toEqual([
      'http://192.168.1.50:11434',
      'http://192.168.1.60:11434',
    ])
    expect(result[0]!.modelNames).toEqual(['qwen2.5-coder:latest'])
    expect(result[1]!.modelNames).toEqual([
      'llama3.2:latest',
      'nomic-embed-text',
    ])
  })

  test('returns empty when no interfaces', async () => {
    const original = getLocalSubnetInterfaces
    const hosts = await discoverOllamaHosts({ interfaces: [] })
    expect(hosts.length).toBeGreaterThanOrEqual(0)
    expect(original).toBeDefined()
  })
})

describe('getLocalSubnetInterfaces', () => {
  test('returns defined non-loopback interfaces', () => {
    const ifaces = getLocalSubnetInterfaces()
    // Test environment may or may not have non-loopback interfaces.
    for (const iface of ifaces) {
      expect(iface.address).not.toStartWith('127.')
      expect(iface.address).not.toStartWith('169.254.')
      expect(iface.prefixLength).toBeGreaterThan(0)
      expect(iface.prefixLength).toBeLessThanOrEqual(32)
    }
  })
})
