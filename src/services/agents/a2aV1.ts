/**
 * A2A v1 compatibility layer.
 *
 * The stable JavaScript SDK still targets A2A v0.3. This adapter keeps that
 * battle-tested execution engine and durable store while translating the v1
 * ProtoJSON model and PascalCase operations at the network boundary. It can be
 * removed once the official JavaScript SDK's v1 line is stable.
 */

import { createHash } from 'node:crypto'
import type { Artifact, Message, Part, Task } from '@a2a-js/sdk'
import {
  A2AProtocolRuntime,
  type A2AProtocolIdentity,
} from './a2aProtocol.js'

export const A2A_V1_PROTOCOL_VERSION = '1.0'
export const A2A_V1_CONTENT_TYPE = 'application/a2a+json'

const MAX_ID_CHARS = 256
const MAX_TENANT_CHARS = 128
const MAX_PARTS = 128
const MAX_METADATA_BYTES = 256_000
const MAX_REFERENCE_TASKS = 100
const MAX_EXTENSIONS = 100

export type A2AV1TaskState =
  | 'TASK_STATE_UNSPECIFIED'
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_AUTH_REQUIRED'

export type A2AV1Role = 'ROLE_USER' | 'ROLE_AGENT'

export type A2AV1Part = {
  text?: string
  raw?: string
  url?: string
  data?: unknown
  metadata?: Record<string, unknown>
  filename?: string
  mediaType?: string
}

export type A2AV1Message = {
  messageId: string
  contextId?: string
  taskId?: string
  role: A2AV1Role
  parts: A2AV1Part[]
  metadata?: Record<string, unknown>
  extensions?: string[]
  referenceTaskIds?: string[]
}

export type A2AV1Artifact = {
  artifactId: string
  name?: string
  description?: string
  parts: A2AV1Part[]
  metadata?: Record<string, unknown>
  extensions?: string[]
}

export type A2AV1Task = {
  id: string
  contextId: string
  status: {
    state: A2AV1TaskState
    message?: A2AV1Message
    timestamp?: string
  }
  artifacts?: A2AV1Artifact[]
  history?: A2AV1Message[]
  metadata?: Record<string, unknown>
}

export type A2AV1ListTasksResponse = {
  tasks: A2AV1Task[]
  nextPageToken: string
  pageSize: number
  totalSize: number
}

export type A2AV1JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: Array<Record<string, unknown>>
  }
}

const ERROR_REASON_BY_CODE: Record<number, string> = {
  [-32602]: 'INVALID_PARAMS',
  [-32603]: 'INTERNAL_ERROR',
  [-32001]: 'TASK_NOT_FOUND',
  [-32002]: 'TASK_NOT_CANCELABLE',
  [-32003]: 'PUSH_NOTIFICATION_NOT_SUPPORTED',
  [-32004]: 'UNSUPPORTED_OPERATION',
  [-32005]: 'CONTENT_TYPE_NOT_SUPPORTED',
  [-32006]: 'INVALID_AGENT_RESPONSE',
  [-32007]: 'EXTENDED_AGENT_CARD_NOT_CONFIGURED',
  [-32008]: 'EXTENSION_SUPPORT_REQUIRED',
  [-32009]: 'VERSION_NOT_SUPPORTED',
}

export class A2AV1Error extends Error {
  readonly code: number
  readonly reason?: string
  readonly details?: Array<Record<string, unknown>>

  constructor(
    code: number,
    message: string,
    options: {
      reason?: string
      details?: Array<Record<string, unknown>>
    } = {},
  ) {
    super(message)
    this.name = 'A2AV1Error'
    this.code = code
    this.reason = options.reason ?? ERROR_REASON_BY_CODE[code]
    this.details = options.details
  }
}

function errorDetails(error: A2AV1Error): Array<Record<string, unknown>> | undefined {
  if (error.details?.length) return error.details
  if (!error.reason) return undefined
  return [
    {
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason: error.reason,
      domain: 'a2a-protocol.org',
    },
  ]
}

function invalidParams(message: string): never {
  throw new A2AV1Error(-32602, message)
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidParams(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function safeId(value: unknown, label: string, required = true): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) invalidParams(`${label} is required`)
    return undefined
  }
  if (
    typeof value !== 'string' ||
    value.length > MAX_ID_CHARS ||
    value.includes('\0')
  ) {
    invalidParams(`${label} must be a safe string of at most ${MAX_ID_CHARS} characters`)
  }
  return value
}

function safeOpaquePageToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4_096 ||
    value.includes('\0')
  ) {
    invalidParams('pageToken must be a safe opaque string of at most 4096 characters')
  }
  return value
}

function optionalMetadata(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  const metadata = asObject(value, label)
  let serialized: string
  try {
    serialized = JSON.stringify(metadata)
  } catch {
    invalidParams(`${label} must be JSON serializable`)
  }
  if (Buffer.byteLength(serialized) > MAX_METADATA_BYTES) {
    invalidParams(`${label} exceeds the ${MAX_METADATA_BYTES}-byte limit`)
  }
  return structuredClone(metadata)
}

function optionalStringList(
  value: unknown,
  label: string,
  maxEntries: number,
): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (
    !Array.isArray(value) ||
    value.length > maxEntries ||
    value.some(
      entry =>
        typeof entry !== 'string' ||
        !entry ||
        entry.length > 2_048 ||
        entry.includes('\0'),
    )
  ) {
    invalidParams(`${label} must contain at most ${maxEntries} safe strings`)
  }
  return [...new Set(value)]
}

function isCanonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return false
  }
  try {
    return Buffer.from(value, 'base64').toString('base64') === value
  } catch {
    return false
  }
}

function parsePart(value: unknown, index: number): Part {
  const part = asObject(value, `message.parts[${index}]`)
  const contentKeys = ['text', 'raw', 'url', 'data'].filter(key =>
    Object.prototype.hasOwnProperty.call(part, key),
  )
  if (contentKeys.length !== 1) {
    invalidParams(
      `message.parts[${index}] must contain exactly one of text, raw, url, or data`,
    )
  }
  const metadata = optionalMetadata(part.metadata, `message.parts[${index}].metadata`)
  const filename =
    part.filename === undefined || part.filename === ''
      ? undefined
      : safeId(part.filename, `message.parts[${index}].filename`)
  let mediaType: string | undefined
  if (part.mediaType !== undefined && part.mediaType !== '') {
    if (
      typeof part.mediaType !== 'string' ||
      part.mediaType.length > 256 ||
      !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+*-]+(?:\s*;[^\r\n\0]*)?$/u.test(
        part.mediaType,
      )
    ) {
      invalidParams(`message.parts[${index}].mediaType is invalid`)
    }
    mediaType = part.mediaType
  }

  if (contentKeys[0] === 'text') {
    if (typeof part.text !== 'string' || part.text.length > 1_000_000) {
      invalidParams(`message.parts[${index}].text must be a string`)
    }
    return {
      kind: 'text',
      text: part.text,
      ...(metadata ? { metadata } : {}),
    }
  }
  if (contentKeys[0] === 'raw') {
    if (typeof part.raw !== 'string' || !isCanonicalBase64(part.raw)) {
      invalidParams(`message.parts[${index}].raw must be canonical base64`)
    }
    return {
      kind: 'file',
      file: {
        bytes: part.raw,
        ...(filename ? { name: filename } : {}),
        ...(mediaType ? { mimeType: mediaType } : {}),
      },
      ...(metadata ? { metadata } : {}),
    }
  }
  if (contentKeys[0] === 'url') {
    if (typeof part.url !== 'string' || part.url.length > 8_192) {
      invalidParams(`message.parts[${index}].url must be an absolute URL`)
    }
    let url: URL
    try {
      url = new URL(part.url)
    } catch {
      invalidParams(`message.parts[${index}].url must be an absolute URL`)
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password
    ) {
      invalidParams(`message.parts[${index}].url must be credential-free HTTP(S)`)
    }
    return {
      kind: 'file',
      file: {
        uri: url.toString(),
        ...(filename ? { name: filename } : {}),
        ...(mediaType ? { mimeType: mediaType } : {}),
      },
      ...(metadata ? { metadata } : {}),
    }
  }

  try {
    const serialized = JSON.stringify(part.data)
    if (
      serialized === undefined ||
      Buffer.byteLength(serialized) > MAX_METADATA_BYTES
    ) {
      invalidParams(`message.parts[${index}].data is too large or unsupported`)
    }
  } catch {
    invalidParams(`message.parts[${index}].data must be JSON serializable`)
  }
  return {
    kind: 'data',
    data: structuredClone(part.data) as Record<string, unknown>,
    ...(metadata ? { metadata } : {}),
  }
}

function parseMessage(value: unknown): Message {
  const message = asObject(value, 'message')
  const messageId = safeId(message.messageId, 'message.messageId') as string
  if (message.role !== 'ROLE_USER' && message.role !== 1) {
    invalidParams('message.role must be ROLE_USER')
  }
  if (
    !Array.isArray(message.parts) ||
    message.parts.length === 0 ||
    message.parts.length > MAX_PARTS
  ) {
    invalidParams(`message.parts must contain between 1 and ${MAX_PARTS} parts`)
  }
  const contextId = safeId(message.contextId, 'message.contextId', false)
  const taskId = safeId(message.taskId, 'message.taskId', false)
  const metadata = optionalMetadata(message.metadata, 'message.metadata')
  const extensions = optionalStringList(
    message.extensions,
    'message.extensions',
    MAX_EXTENSIONS,
  )
  const referenceTaskIds = optionalStringList(
    message.referenceTaskIds,
    'message.referenceTaskIds',
    MAX_REFERENCE_TASKS,
  )
  return {
    kind: 'message',
    messageId,
    role: 'user',
    parts: message.parts.map(parsePart),
    ...(contextId ? { contextId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(metadata ? { metadata } : {}),
    ...(extensions?.length ? { extensions } : {}),
    ...(referenceTaskIds?.length ? { referenceTaskIds } : {}),
  }
}

function toV1Part(part: Part): A2AV1Part {
  if (part.kind === 'text') {
    return {
      text: part.text,
      ...(part.metadata ? { metadata: structuredClone(part.metadata) } : {}),
    }
  }
  if (part.kind === 'data') {
    return {
      data: structuredClone(part.data),
      ...(part.metadata ? { metadata: structuredClone(part.metadata) } : {}),
    }
  }
  if (part.kind === 'file') {
    const common = {
      ...(part.file.name ? { filename: part.file.name } : {}),
      ...(part.file.mimeType ? { mediaType: part.file.mimeType } : {}),
      ...(part.metadata ? { metadata: structuredClone(part.metadata) } : {}),
    }
    return 'bytes' in part.file
      ? { raw: part.file.bytes, ...common }
      : { url: part.file.uri, ...common }
  }
  throw new A2AV1Error(-32006, `Unsupported agent part kind: ${String((part as { kind?: unknown }).kind)}`)
}

function toV1Message(message: Message): A2AV1Message {
  return {
    messageId: message.messageId,
    role: message.role === 'agent' ? 'ROLE_AGENT' : 'ROLE_USER',
    parts: message.parts.map(toV1Part),
    ...(message.contextId ? { contextId: message.contextId } : {}),
    ...(message.taskId ? { taskId: message.taskId } : {}),
    ...(message.metadata ? { metadata: structuredClone(message.metadata) } : {}),
    ...(message.extensions?.length ? { extensions: [...message.extensions] } : {}),
    ...(message.referenceTaskIds?.length
      ? { referenceTaskIds: [...message.referenceTaskIds] }
      : {}),
  }
}

function toV1Artifact(artifact: Artifact): A2AV1Artifact {
  return {
    artifactId: artifact.artifactId,
    parts: artifact.parts.map(toV1Part),
    ...(artifact.name ? { name: artifact.name } : {}),
    ...(artifact.description ? { description: artifact.description } : {}),
    ...(artifact.metadata ? { metadata: structuredClone(artifact.metadata) } : {}),
    ...(artifact.extensions?.length
      ? { extensions: [...artifact.extensions] }
      : {}),
  }
}

const V1_STATE_BY_LEGACY: Record<Task['status']['state'], A2AV1TaskState> = {
  submitted: 'TASK_STATE_SUBMITTED',
  working: 'TASK_STATE_WORKING',
  completed: 'TASK_STATE_COMPLETED',
  failed: 'TASK_STATE_FAILED',
  canceled: 'TASK_STATE_CANCELED',
  'input-required': 'TASK_STATE_INPUT_REQUIRED',
  rejected: 'TASK_STATE_REJECTED',
  'auth-required': 'TASK_STATE_AUTH_REQUIRED',
  unknown: 'TASK_STATE_UNSPECIFIED',
}

const LEGACY_STATE_BY_V1: Partial<
  Record<A2AV1TaskState, Task['status']['state']>
> = {
  TASK_STATE_SUBMITTED: 'submitted',
  TASK_STATE_WORKING: 'working',
  TASK_STATE_COMPLETED: 'completed',
  TASK_STATE_FAILED: 'failed',
  TASK_STATE_CANCELED: 'canceled',
  TASK_STATE_INPUT_REQUIRED: 'input-required',
  TASK_STATE_REJECTED: 'rejected',
  TASK_STATE_AUTH_REQUIRED: 'auth-required',
}

export function toA2AV1Task(task: Task): A2AV1Task {
  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: V1_STATE_BY_LEGACY[task.status.state],
      ...(task.status.message
        ? { message: toV1Message(task.status.message) }
        : {}),
      ...(task.status.timestamp ? { timestamp: task.status.timestamp } : {}),
    },
    ...(task.artifacts?.length
      ? { artifacts: task.artifacts.map(toV1Artifact) }
      : {}),
    ...(task.history?.length
      ? { history: task.history.map(toV1Message) }
      : {}),
    ...(task.metadata ? { metadata: structuredClone(task.metadata) } : {}),
  }
}

function parseNonNegativeInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const numeric = typeof value === 'string' ? Number(value) : value
  if (
    typeof numeric !== 'number' ||
    !Number.isSafeInteger(numeric) ||
    numeric < 0
  ) {
    invalidParams(`${label} must be a non-negative integer`)
  }
  return numeric
}

export function validateA2AV1Tenant(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (
    typeof value !== 'string' ||
    value.length > MAX_TENANT_CHARS ||
    value.includes('\0') ||
    !/^[A-Za-z0-9._~-]+$/u.test(value)
  ) {
    invalidParams(
      `tenant must be a URL-safe string of at most ${MAX_TENANT_CHARS} characters`,
    )
  }
  return value
}

export function namespaceA2AV1Identity(
  identity: A2AProtocolIdentity,
  tenant: string,
  requestedSkill?: string,
): A2AProtocolIdentity {
  return {
    ...identity,
    userName: tenant
      ? `a2a-v1-tenant:${createHash('sha256')
          .update(`${tenant}\0${identity.userName}`)
          .digest('base64url')}`
      : identity.userName,
    ...(requestedSkill ? { requestedSkill } : {}),
  }
}

function requestedSkillFromObject(value: Record<string, unknown>): string {
  const message =
    value.message && typeof value.message === 'object' && !Array.isArray(value.message)
      ? (value.message as Record<string, unknown>)
      : undefined
  for (const candidate of [value.metadata, message?.metadata]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue
    }
    const skill = (candidate as Record<string, unknown>).skill
    if (typeof skill === 'string' && skill.trim()) return skill.trim()
  }
  return 'coding-agent'
}

function promptFromRawMessage(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return undefined
  }
  const parts = (message as Record<string, unknown>).parts
  if (!Array.isArray(parts)) return undefined
  return parts
    .map(part => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return ''
      const value = part as Record<string, unknown>
      if (typeof value.text === 'string') return value.text
      if (Object.prototype.hasOwnProperty.call(value, 'data')) {
        try {
          return JSON.stringify(value.data)
        } catch {
          return ''
        }
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export type A2AV1Inspection = {
  id: string | number | null
  method?: string
  prompt?: string
  skill: string
  tenant: string
}

export function inspectA2AV1Request(
  payload: unknown,
  restTenant = '',
): A2AV1Inspection {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      id: null,
      skill: 'coding-agent',
      tenant: validateA2AV1Tenant(restTenant),
    }
  }
  const request = payload as Record<string, unknown>
  const method = typeof request.method === 'string' ? request.method : undefined
  const params =
    method && request.params && typeof request.params === 'object' && !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : request
  return {
    id:
      typeof request.id === 'string' ||
      (typeof request.id === 'number' && Number.isSafeInteger(request.id))
        ? request.id
        : null,
    ...(method ? { method } : {}),
    prompt: promptFromRawMessage(params.message),
    skill: requestedSkillFromObject(params),
    tenant: validateA2AV1Tenant(restTenant || params.tenant),
  }
}

function runtimeError(response: {
  error?: { code: number; message: string; data?: unknown }
}): never {
  const error = response.error
  if (!error) throw new A2AV1Error(-32603, 'A2A runtime returned no result')
  throw new A2AV1Error(error.code, error.message, {
    details: Array.isArray(error.data)
      ? (error.data as Array<Record<string, unknown>>)
      : undefined,
  })
}

function taskFromRuntimeResult(result: unknown): Task {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    (result as { kind?: unknown }).kind !== 'task'
  ) {
    throw new A2AV1Error(-32006, 'A2A runtime returned an invalid Task')
  }
  return result as Task
}

export class A2AV1ProtocolRuntime {
  readonly #runtime: A2AProtocolRuntime

  constructor(runtime: A2AProtocolRuntime) {
    this.#runtime = runtime
  }

  async sendMessage(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<{ task: A2AV1Task } | { message: A2AV1Message }> {
    const request = asObject(value, 'SendMessageRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const message = parseMessage(request.message)
    const configuration =
      request.configuration === undefined || request.configuration === null
        ? {}
        : asObject(request.configuration, 'configuration')
    if (
      configuration.returnImmediately !== undefined &&
      typeof configuration.returnImmediately !== 'boolean'
    ) {
      invalidParams('configuration.returnImmediately must be a boolean')
    }
    if (configuration.taskPushNotificationConfig !== undefined) {
      throw new A2AV1Error(
        -32003,
        'Push notifications are not supported by this agent',
      )
    }
    const historyLength = parseNonNegativeInteger(
      configuration.historyLength,
      'configuration.historyLength',
    )
    let acceptedOutputModes: string[] | undefined
    if (configuration.acceptedOutputModes !== undefined) {
      acceptedOutputModes = optionalStringList(
        configuration.acceptedOutputModes,
        'configuration.acceptedOutputModes',
        32,
      )
    }
    const metadata = optionalMetadata(request.metadata, 'metadata')
    const skill = requestedSkillFromObject(request)
    const scopedIdentity = namespaceA2AV1Identity(identity, tenant, skill)
    const response = await this.#runtime.handle(
      {
        jsonrpc: '2.0',
        id: 'a2a-v1-adapter',
        method: 'message/send',
        params: {
          message,
          configuration: {
            blocking: configuration.returnImmediately !== true,
            ...(historyLength !== undefined ? { historyLength } : {}),
            ...(acceptedOutputModes?.length ? { acceptedOutputModes } : {}),
          },
          ...(metadata ? { metadata } : {}),
        },
      },
      scopedIdentity,
    )
    if ('error' in response) runtimeError(response)
    const result = response.result
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new A2AV1Error(-32006, 'A2A runtime returned an invalid response')
    }
    if ((result as { kind?: unknown }).kind === 'task') {
      return { task: toA2AV1Task(result as Task) }
    }
    if ((result as { kind?: unknown }).kind === 'message') {
      return { message: toV1Message(result as Message) }
    }
    throw new A2AV1Error(-32006, 'A2A runtime returned an unknown response type')
  }

  async getTask(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<A2AV1Task> {
    const request = asObject(value, 'GetTaskRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const id = safeId(request.id, 'id') as string
    const historyLength = parseNonNegativeInteger(
      request.historyLength,
      'historyLength',
    )
    const response = await this.#runtime.handle(
      {
        jsonrpc: '2.0',
        id: 'a2a-v1-adapter',
        method: 'tasks/get',
        params: {
          id,
          ...(historyLength !== undefined ? { historyLength } : {}),
        },
      },
      namespaceA2AV1Identity(identity, tenant),
    )
    if ('error' in response) runtimeError(response)
    return toA2AV1Task(taskFromRuntimeResult(response.result))
  }

  async listTasks(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<A2AV1ListTasksResponse> {
    const request = asObject(value, 'ListTasksRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const contextId = safeId(request.contextId, 'contextId', false)
    const pageSize = parseNonNegativeInteger(request.pageSize, 'pageSize') ?? 50
    if (pageSize < 1 || pageSize > 100) {
      invalidParams('pageSize must be between 1 and 100')
    }
    const historyLength = parseNonNegativeInteger(
      request.historyLength,
      'historyLength',
    )
    let status: Task['status']['state'] | undefined
    if (
      request.status !== undefined &&
      request.status !== null &&
      request.status !== '' &&
      request.status !== 0 &&
      request.status !== 'TASK_STATE_UNSPECIFIED'
    ) {
      if (
        typeof request.status !== 'string' ||
        !LEGACY_STATE_BY_V1[request.status as A2AV1TaskState]
      ) {
        invalidParams('status is not a recognized TaskState')
      }
      status = LEGACY_STATE_BY_V1[request.status as A2AV1TaskState]
    }
    let statusTimestampAfter: string | undefined
    if (request.statusTimestampAfter !== undefined && request.statusTimestampAfter !== '') {
      if (
        typeof request.statusTimestampAfter !== 'string' ||
        !request.statusTimestampAfter.endsWith('Z') ||
        !Number.isFinite(Date.parse(request.statusTimestampAfter))
      ) {
        invalidParams('statusTimestampAfter must be an ISO 8601 UTC timestamp')
      }
      statusTimestampAfter = request.statusTimestampAfter
    }
    const pageToken =
      request.pageToken === undefined || request.pageToken === ''
        ? undefined
        : safeOpaquePageToken(request.pageToken)
    if (
      request.includeArtifacts !== undefined &&
      typeof request.includeArtifacts !== 'boolean'
    ) {
      invalidParams('includeArtifacts must be a boolean')
    }
    const result = await this.#runtime.listTasks(
      {
        ...(contextId ? { contextId } : {}),
        ...(status ? { status } : {}),
        pageSize,
        ...(pageToken ? { pageToken } : {}),
        ...(historyLength !== undefined ? { historyLength } : {}),
        ...(statusTimestampAfter ? { statusTimestampAfter } : {}),
        includeArtifacts: request.includeArtifacts === true,
      },
      namespaceA2AV1Identity(identity, tenant),
    )
    return {
      tasks: result.tasks.map(toA2AV1Task),
      nextPageToken: result.nextPageToken,
      pageSize: result.pageSize,
      totalSize: result.totalSize,
    }
  }

  async cancelTask(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<A2AV1Task> {
    const request = asObject(value, 'CancelTaskRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const id = safeId(request.id, 'id') as string
    optionalMetadata(request.metadata, 'metadata')
    const response = await this.#runtime.handle(
      {
        jsonrpc: '2.0',
        id: 'a2a-v1-adapter',
        method: 'tasks/cancel',
        params: { id },
      },
      namespaceA2AV1Identity(identity, tenant),
    )
    if ('error' in response) runtimeError(response)
    return toA2AV1Task(taskFromRuntimeResult(response.result))
  }

  async handleJsonRpc(
    payload: unknown,
    identity: A2AProtocolIdentity,
  ): Promise<A2AV1JsonRpcResponse> {
    let id: string | number | null = null
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new A2AV1Error(-32600, 'Invalid JSON-RPC Request')
      }
      const request = payload as Record<string, unknown>
      if (
        request.id !== undefined &&
        request.id !== null &&
        typeof request.id !== 'string' &&
        !(typeof request.id === 'number' && Number.isSafeInteger(request.id))
      ) {
        throw new A2AV1Error(-32600, 'Invalid JSON-RPC request id')
      }
      id =
        typeof request.id === 'string' || typeof request.id === 'number'
          ? request.id
          : null
      if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
        throw new A2AV1Error(-32600, 'Invalid JSON-RPC Request')
      }
      if (
        request.method !== 'GetExtendedAgentCard' &&
        (!request.params ||
          typeof request.params !== 'object' ||
          Array.isArray(request.params))
      ) {
        invalidParams('Invalid method parameters')
      }
      const params = request.params ?? {}
      let result: unknown
      switch (request.method) {
        case 'SendMessage':
          result = await this.sendMessage(params, identity)
          break
        case 'GetTask':
          result = await this.getTask(params, identity)
          break
        case 'ListTasks':
          result = await this.listTasks(params, identity)
          break
        case 'CancelTask':
          result = await this.cancelTask(params, identity)
          break
        case 'SendStreamingMessage':
        case 'SubscribeToTask':
          throw new A2AV1Error(
            -32004,
            `Method ${request.method} requires streaming capability`,
          )
        case 'CreateTaskPushNotificationConfig':
        case 'GetTaskPushNotificationConfig':
        case 'ListTaskPushNotificationConfigs':
        case 'DeleteTaskPushNotificationConfig':
          throw new A2AV1Error(
            -32003,
            'Push notifications are not supported by this agent',
          )
        case 'GetExtendedAgentCard':
          throw new A2AV1Error(
            -32007,
            'Extended Agent Card is not configured',
          )
        default:
          throw new A2AV1Error(-32601, 'Invalid method')
      }
      return { jsonrpc: '2.0', id, result }
    } catch (error) {
      const mapped =
        error instanceof A2AV1Error
          ? error
          : new A2AV1Error(
              -32603,
              error instanceof Error
                ? error.message
                : 'An unexpected error occurred',
            )
      const details = errorDetails(mapped)
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: mapped.code,
          message: mapped.message,
          ...(details ? { data: details } : {}),
        },
      }
    }
  }
}

export function a2aV1VersionError(
  id: string | number | null,
  requestedVersion: string,
): A2AV1JsonRpcResponse {
  const error = new A2AV1Error(
    -32009,
    `The requested A2A protocol version '${requestedVersion}' is not supported. Supported versions: ${A2A_V1_PROTOCOL_VERSION}`,
  )
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: error.code,
      message: error.message,
      data: errorDetails(error),
    },
  }
}

export function a2aV1HttpError(error: unknown): {
  status: number
  body: {
    error: {
      code: number
      status: string
      message: string
      details: Array<Record<string, unknown>>
    }
  }
} {
  const mapped =
    error instanceof A2AV1Error
      ? error
      : new A2AV1Error(
          -32603,
          error instanceof Error ? error.message : 'An unexpected error occurred',
        )
  const status =
    mapped.code === -32001
      ? 404
      : mapped.code === -32002
        ? 409
        : mapped.code === -32005
          ? 415
          : mapped.code === -32601
            ? 404
            : mapped.code === -32603 || mapped.code === -32006
              ? 500
              : 400
  const statusName =
    status === 404
      ? 'NOT_FOUND'
      : status === 409
        ? 'FAILED_PRECONDITION'
        : status === 415
          ? 'UNSUPPORTED_MEDIA_TYPE'
      : status === 500
        ? 'INTERNAL'
        : mapped.code >= -32009 && mapped.code <= -32002
          ? 'FAILED_PRECONDITION'
          : 'INVALID_ARGUMENT'
  return {
    status,
    body: {
      error: {
        code: status,
        status: statusName,
        message: mapped.message,
        details: errorDetails(mapped) ?? [],
      },
    },
  }
}
