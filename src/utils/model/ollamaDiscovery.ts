import { networkInterfaces } from 'node:os'
import { connect as defaultConnect } from 'node:net'
import type { Socket } from 'node:net'
import { parseOllamaModelNames } from './ollamaModels.js'

export type DiscoveredHost = {
  host: string
  modelNames: string[]
}

export type LocalInterface = {
  name: string
  address: string
  prefixLength: number
}

export type ConnectFn = (
  options: { host: string; port: number },
  callback?: () => void,
) => Socket

export type DiscoveryOptions = {
  port?: number
  tcpTimeoutMs?: number
  httpTimeoutMs?: number
  concurrency?: number
  signal?: AbortSignal
  connect?: ConnectFn
  /** Override the scanned subnets. Each entry is [address, prefixLength]. */
  subnets?: Array<[string, number]>
}

/**
 * Enumerate non-loopback, non-link-local IPv4 interfaces with their CIDR prefix.
 * Exported for tests.
 */
export function getLocalSubnetInterfaces(): LocalInterface[] {
  const result: LocalInterface[] = []
  const ifaces = networkInterfaces()
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4') continue
      if (entry.internal) continue
      const address = entry.address
      if (!address || address.startsWith('127.')) continue
      // Link-local 169.254.x.x
      if (address.startsWith('169.254.')) continue
      result.push({
        name,
        address,
        prefixLength: entry.cidr ? parsePrefixLength(entry.cidr) : 24,
      })
    }
  }
  return result
}

function parsePrefixLength(cidr: string): number {
  const slash = cidr.lastIndexOf('/')
  if (slash === -1) return 24
  const parsed = Number.parseInt(cidr.slice(slash + 1), 10)
  return Number.isNaN(parsed) ? 24 : parsed
}

/** Convert IPv4 string to 32-bit integer. */
export function ipToLong(ip: string): number {
  const parts = ip.split('.')
  if (parts.length !== 4) return 0
  let value = 0
  for (const part of parts) {
    const num = Number.parseInt(part, 10)
    if (Number.isNaN(num) || num < 0 || num > 255) return 0
    value = (value << 8) | num
  }
  return value >>> 0
}

/** Convert 32-bit integer to IPv4 string. */
export function longToIp(value: number): string {
  value = value >>> 0
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.')
}

/** List all host addresses in the given CIDR subnet, excluding network and broadcast. */
export function listSubnetHosts(address: string, prefixLength: number): string[] {
  const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0
  const network = ipToLong(address) & mask
  const broadcast = network | (~mask >>> 0)
  const hosts: string[] = []
  // Only support /24 or smaller for local networks to keep scans reasonable.
  // For wider prefixes, still scan but cap at /16 worth of hosts.
  const start = network + 1
  const end = Math.min(broadcast - 1, network + 65_534)
  for (let ip = start; ip <= end; ip++) {
    hosts.push(longToIp(ip))
  }
  return hosts
}

function isOllamaHostExcluded(host: string): boolean {
  const lower = host.toLowerCase()
  return (
    lower.includes('localhost') ||
    lower.startsWith('127.') ||
    lower === '::1'
  )
}

async function probeTcpPort(
  host: string,
  port: number,
  timeoutMs: number,
  connect: ConnectFn,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false
  return new Promise(resolve => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const onAbort = () => {
      socket.destroy()
      finish(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      socket.destroy()
      finish(false)
    }, timeoutMs)
    const socket = connect({ host, port }, () => {
      clearTimeout(timer)
      socket.end()
      finish(true)
    })
    socket.on('error', () => {
      clearTimeout(timer)
      finish(false)
    })
    socket.on('close', () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    })
  })
}

async function verifyOllamaHost(
  host: string,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<DiscoveredHost | null> {
  if (signal?.aborted) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  signal?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    const response = await fetch(`http://${host}:${port}/api/tags`, {
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body = await response.json()
    const modelNames = parseOllamaModelNames(body)
    return { host: `http://${host}:${port}`, modelNames }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function runWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = []
  let index = 0
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i]!)
    }
  }
  const workers = new Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker())
  await Promise.all(workers)
  return results
}

/**
 * Discover Ollama servers on the local network.
 *
 * Scans the active local IPv4 subnets for open TCP port 11434, then verifies
 * each open host by fetching /api/tags. Returns verified hosts plus the
 * models advertised by each. Localhost is intentionally excluded from scanning
 * because the local server is always offered as a fixed option.
 */
export async function discoverOllamaHosts(
  options: DiscoveryOptions = {},
): Promise<DiscoveredHost[]> {
  const {
    port = 11434,
    tcpTimeoutMs = 500,
    httpTimeoutMs = 1000,
    concurrency = 50,
    signal,
    connect = defaultConnect,
    subnets,
  } = options
  if (signal?.aborted) return []

  const hosts = new Set<string>()
  if (subnets) {
    for (const [address, prefixLength] of subnets) {
      for (const host of listSubnetHosts(address, prefixLength)) {
        hosts.add(host)
      }
    }
  } else {
    const interfaces = getLocalSubnetInterfaces()
    if (interfaces.length === 0) return []
    for (const iface of interfaces) {
      for (const host of listSubnetHosts(iface.address, iface.prefixLength)) {
        hosts.add(host)
      }
    }
  }
  const candidates = [...hosts].filter(h => !isOllamaHostExcluded(h))
  if (candidates.length === 0) return []

  const openPorts = await runWithConcurrency(
    candidates,
    concurrency,
    async host => {
      const open = await probeTcpPort(host, port, tcpTimeoutMs, connect, signal)
      return open ? host : null
    },
  )

  const openHosts = openPorts.filter((h): h is string => h !== null)
  if (openHosts.length === 0) return []

  const verified = await runWithConcurrency(
    openHosts,
    concurrency,
    async host => verifyOllamaHost(host, port, httpTimeoutMs, signal),
  )

  return verified
    .filter((h): h is DiscoveredHost => h !== null)
    .sort((a, b) => a.host.localeCompare(b.host))
}
