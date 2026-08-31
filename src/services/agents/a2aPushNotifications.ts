import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import type {
  StreamResponse,
  Task,
  TaskPushNotificationConfig,
} from '@a2a-js/sdk'
import { RequestMalformedError } from '@a2a-js/sdk/errors'
import {
  V1PushNotificationSerializer,
  type PushNotificationSender,
  type PushNotificationStore,
  type SerializedPushNotification,
  type StoredPushNotificationConfig,
  type ServerCallContext,
} from '@a2a-js/sdk/server'
import { V03PushNotificationSerializer } from '@a2a-js/sdk/compat/v0_3/server'
import { readPositiveInteger } from '../../utils/rollingRateLimiter.js'

const MAX_CONFIGS_PER_TASK = 10
const MAX_URL_CHARS = 2_048
const MAX_AUTH_CHARS = 8_192

type ResolvedWebhook = {
  url: URL
  address: string
  family: 4 | 6
}

type StoredConfig = StoredPushNotificationConfig & {
  owner: string
  tenant: string
}

function cloneConfig(
  config: TaskPushNotificationConfig,
): TaskPushNotificationConfig {
  return structuredClone(config)
}

function owner(context: ServerCallContext): string {
  return context.user?.userName || 'unknown'
}

function tenant(context: ServerCallContext): string {
  return context.tenant ?? ''
}

function taskKey(
  taskId: string,
  context: ServerCallContext,
): string {
  return `${tenant(context)}\0${owner(context)}\0${taskId}`
}

function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.UR_A2A_PUSH_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => {
        try {
          return new URL(value).origin
        } catch {
          return ''
        }
      })
      .filter(Boolean),
  )
}

function blockedIPv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value))) {
    return true
  }
  const [a, b] = octets as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  )
}

function mappedIPv4(address: string): string | undefined {
  const normalized = address.toLowerCase()
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)
  return match?.[1]
}

function ipv6Groups(address: string): number[] | undefined {
  const normalized = address.toLowerCase().split('%', 1)[0] ?? ''
  let value = normalized
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/u.exec(value)?.[1]
  if (dotted) {
    const octets = dotted.split('.').map(Number)
    if (octets.length !== 4 || octets.some(octet => octet < 0 || octet > 255)) {
      return undefined
    }
    value = `${value.slice(0, -dotted.length)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`
  }
  const halves = value.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map(group => Number.parseInt(group || '0', 16))
  if (
    groups.length !== 8 ||
    groups.some(group => !Number.isInteger(group) || group < 0 || group > 0xffff)
  ) {
    return undefined
  }
  return groups
}

function blockedIPAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return blockedIPv4(address)
  if (family !== 6) return true
  const normalized = address.toLowerCase().split('%', 1)[0] ?? ''
  const mapped = mappedIPv4(normalized)
  if (mapped) return blockedIPv4(mapped)
  const groups = ipv6Groups(normalized)
  if (!groups) return true
  const embeddedIPv4 = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`
  const isUnspecifiedOrLoopback =
    groups.slice(0, 7).every(group => group === 0) &&
    (groups[7] === 0 || groups[7] === 1)
  const isMappedOrCompatible =
    groups.slice(0, 5).every(group => group === 0) &&
    (groups[5] === 0 || groups[5] === 0xffff)
  const isSixToFour = groups[0] === 0x2002
  return (
    isUnspecifiedOrLoopback ||
    (groups[0]! & 0xfe00) === 0xfc00 ||
    (groups[0]! & 0xffc0) === 0xfe80 ||
    (groups[0]! & 0xff00) === 0xff00 ||
    (groups[0] === 0x2001 && groups[1] === 0x0db8) ||
    (groups[0] === 0x2001 && groups[1] === 0) ||
    ((isMappedOrCompatible || isSixToFour) && blockedIPv4(embeddedIPv4))
  )
}

function blockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '')
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa')
  )
}

function isLoopbackAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return address.split('.')[0] === '127'
  if (family !== 6) return false
  const mapped = mappedIPv4(address)
  if (mapped) return isLoopbackAddress(mapped)
  const groups = ipv6Groups(address)
  if (!groups) return false
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) {
    return true
  }
  const isMappedOrCompatible =
    groups.slice(0, 5).every(group => group === 0) &&
    (groups[5] === 0 || groups[5] === 0xffff)
  if (!isMappedOrCompatible) return false
  const embedded = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`
  return isLoopbackAddress(embedded)
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '')
  return normalized === 'localhost' || normalized.endsWith('.localhost')
}

function validateAuthentication(
  config: TaskPushNotificationConfig,
  localLoopback: boolean,
): void {
  const authentication = config.authentication
  if (!authentication) {
    // Local receivers are a normal development path and should work without
    // provisioning a throwaway secret. Public push destinations still require
    // an explicit credential.
    if (localLoopback) return
    throw new RequestMalformedError(
      'Public A2A push notification endpoints require authentication credentials',
    )
  }
  if (
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/u.test(authentication.scheme) ||
    !authentication.credentials ||
    authentication.credentials.length > MAX_AUTH_CHARS ||
    /[\r\n\0]/u.test(authentication.credentials)
  ) {
    throw new RequestMalformedError(
      'A2A push notification authentication is invalid',
    )
  }
}

/**
 * Resolve and validate a webhook before every delivery. The returned address
 * is pinned into the HTTPS request's lookup callback, closing the DNS-rebinding
 * window that exists when validation and fetch perform separate resolutions.
 */
export async function resolveSecureA2APushUrl(
  value: string,
): Promise<ResolvedWebhook> {
  if (!value || value.length > MAX_URL_CHARS || /[\r\n\0]/u.test(value)) {
    throw new RequestMalformedError('A2A push notification URL is invalid')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new RequestMalformedError(
      'A2A push notification URL must be absolute',
    )
  }
  if (url.username || url.password || url.hash) {
    throw new RequestMalformedError(
      'A2A push notification URL must not contain credentials or a fragment',
    )
  }
  const explicitlyAllowed = allowedOrigins().has(url.origin)
  const hostname = url.hostname.replace(/^\[|\]$/gu, '')
  const literalFamily = isIP(hostname)
  const localLoopback =
    isLoopbackHostname(hostname) ||
    (literalFamily !== 0 && isLoopbackAddress(hostname))
  if (url.protocol !== 'https:' && !explicitlyAllowed && !localLoopback) {
    throw new RequestMalformedError(
      'A2A push notification URL must use HTTPS unless its exact origin is explicitly allowed',
    )
  }
  if (blockedHostname(hostname) && !explicitlyAllowed && !localLoopback) {
    throw new RequestMalformedError(
      'A2A push notification URL targets a local hostname',
    )
  }

  if (literalFamily !== 0) {
    if (
      blockedIPAddress(hostname) &&
      !explicitlyAllowed &&
      !isLoopbackAddress(hostname)
    ) {
      throw new RequestMalformedError(
        'A2A push notification URL targets a non-public IP address',
      )
    }
    return {
      url,
      address: hostname,
      family: literalFamily as 4 | 6,
    }
  }

  const dnsTimeoutMs = readPositiveInteger(
    process.env.UR_A2A_PUSH_DNS_TIMEOUT_MS,
    3_000,
    30_000,
  )
  let dnsTimer: ReturnType<typeof setTimeout> | undefined
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      dnsTimer = setTimeout(
        () => reject(new Error('A2A push notification DNS lookup timed out')),
        dnsTimeoutMs,
      )
      dnsTimer.unref?.()
    }),
  ])
    .catch(error => {
      throw new RequestMalformedError({
        message:
          error instanceof Error
            ? error.message
            : 'A2A push notification hostname did not resolve',
        cause: error,
      })
    })
    .finally(() => {
      if (dnsTimer) clearTimeout(dnsTimer)
    })
  if (addresses.length === 0) {
    throw new RequestMalformedError(
      'A2A push notification hostname did not resolve',
    )
  }
  const resolvedOnlyToLoopback =
    localLoopback && addresses.every(candidate => isLoopbackAddress(candidate.address))
  if (
    !explicitlyAllowed &&
    !resolvedOnlyToLoopback &&
    addresses.some(candidate => blockedIPAddress(candidate.address))
  ) {
    throw new RequestMalformedError(
      'A2A push notification hostname resolves to a non-public IP address',
    )
  }
  const selected = addresses[0]!
  return {
    url,
    address: selected.address,
    family: selected.family as 4 | 6,
  }
}

export class SecureA2APushNotificationStore
  implements PushNotificationStore
{
  readonly #configs = new Map<string, StoredConfig[]>()

  async save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig,
  ): Promise<void> {
    const resolved = await resolveSecureA2APushUrl(pushNotificationConfig.url)
    validateAuthentication(
      pushNotificationConfig,
      isLoopbackAddress(resolved.address),
    )
    if (!pushNotificationConfig.id) pushNotificationConfig.id = randomUUID()
    pushNotificationConfig.taskId = taskId
    pushNotificationConfig.tenant = tenant(context)
    const key = taskKey(taskId, context)
    const previous = this.#configs.get(key) ?? []
    const existing = previous.findIndex(
      entry => entry.config.id === pushNotificationConfig.id,
    )
    if (existing < 0 && previous.length >= MAX_CONFIGS_PER_TASK) {
      throw new RequestMalformedError(
        `A2A tasks may have at most ${MAX_CONFIGS_PER_TASK} push notification configurations`,
      )
    }
    const stored: StoredConfig = {
      owner: owner(context),
      tenant: tenant(context),
      wireVersion: context.requestedVersion || '1.0',
      config: cloneConfig(pushNotificationConfig),
    }
    const next = [...previous]
    if (existing >= 0) next[existing] = stored
    else next.push(stored)
    this.#configs.set(key, next)
  }

  async load(
    taskId: string,
    context: ServerCallContext,
  ): Promise<TaskPushNotificationConfig[]> {
    return (this.#configs.get(taskKey(taskId, context)) ?? []).map(entry =>
      cloneConfig(entry.config),
    )
  }

  async loadWithMetadata(
    taskId: string,
    context: ServerCallContext,
  ): Promise<StoredPushNotificationConfig[]> {
    return (this.#configs.get(taskKey(taskId, context)) ?? []).map(entry => ({
      wireVersion: entry.wireVersion,
      config: cloneConfig(entry.config),
    }))
  }

  async delete(
    taskId: string,
    context: ServerCallContext,
    configId?: string,
  ): Promise<void> {
    const key = taskKey(taskId, context)
    if (!configId) {
      this.#configs.delete(key)
      return
    }
    const remaining = (this.#configs.get(key) ?? []).filter(
      entry => entry.config.id !== configId,
    )
    if (remaining.length === 0) this.#configs.delete(key)
    else this.#configs.set(key, remaining)
  }
}

async function postPinned(
  resolved: ResolvedWebhook,
  serialized: SerializedPushNotification,
  authorization?: string,
): Promise<void> {
  const timeout = readPositiveInteger(
    process.env.UR_A2A_PUSH_TIMEOUT_MS,
    5_000,
    60_000,
  )
  await new Promise<void>((resolve, reject) => {
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, resolved.address, resolved.family)
    }
    const sendRequest =
      resolved.url.protocol === 'http:' ? httpRequest : httpsRequest
    const request = sendRequest(
      resolved.url,
      {
        method: 'POST',
        headers: {
          ...(authorization ? { authorization } : {}),
          'content-type': serialized.contentType,
          'content-length': Buffer.byteLength(serialized.body),
          'user-agent': 'UR-A2A/1.0',
        },
        lookup: pinnedLookup,
        ...(resolved.url.protocol === 'https:'
          ? { servername: resolved.url.hostname.replace(/^\[|\]$/gu, '') }
          : {}),
        timeout,
      },
      response => {
        response.resume()
        if (
          response.statusCode !== undefined &&
          response.statusCode >= 200 &&
          response.statusCode < 300
        ) {
          resolve()
        } else {
          reject(
            new Error(
              `A2A push endpoint returned HTTP ${response.statusCode ?? 'unknown'}`,
            ),
          )
        }
      },
    )
    request.once('timeout', () =>
      request.destroy(new Error('A2A push notification timed out')),
    )
    request.once('error', reject)
    request.end(serialized.body)
  })
}

export class SecureA2APushNotificationSender
  implements PushNotificationSender
{
  readonly #v1 = new V1PushNotificationSerializer()
  readonly #v03 = new V03PushNotificationSerializer()

  constructor(readonly store: SecureA2APushNotificationStore) {}

  async send(
    streamResponse: StreamResponse,
    context: ServerCallContext,
    task?: Task,
  ): Promise<void> {
    const payload = streamResponse.payload
    const taskId =
      payload?.$case === 'task'
        ? payload.value.id
        : payload?.$case === 'statusUpdate' ||
            payload?.$case === 'artifactUpdate'
          ? payload.value.taskId
          : payload?.$case === 'message'
            ? payload.value.taskId
            : ''
    if (!taskId) return
    const entries = await this.store.loadWithMetadata(taskId, context)
    const deliveries = await Promise.allSettled(
      entries.map(async entry => {
        const authentication = entry.config.authentication
        // Resolve immediately before sending and pin that exact address into
        // the request. Redirects are never followed.
        const resolved = await resolveSecureA2APushUrl(entry.config.url)
        const serialized =
          entry.wireVersion === '0.3'
            ? this.#v03.serialize(streamResponse, task)
            : this.#v1.serialize(streamResponse, task)
        await postPinned(
          resolved,
          serialized,
          authentication
            ? `${authentication.scheme} ${authentication.credentials}`
            : undefined,
        )
      }),
    )
    for (const delivery of deliveries) {
      if (delivery.status === 'rejected') {
        console.warn(
          `A2A push delivery failed: ${
            delivery.reason instanceof Error
              ? delivery.reason.message
              : 'unknown delivery error'
          }`,
        )
      }
    }
  }
}
