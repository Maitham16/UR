import { createHash } from 'node:crypto'
import {
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTasksRequest,
  Message,
  SendMessageRequest,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
  TaskState,
  taskStateFromJSON,
  taskStateToJSON,
  type ListTasksResponse,
} from '@a2a-js/sdk'
import {
  A2AError as SDKError,
  restStatusFor,
  toJsonRpcError,
  toRestErrorBody,
} from '@a2a-js/sdk/errors'
import {
  A2AProtocolRuntime,
  type A2AJsonRpcResponse,
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

export type A2AV1JsonRpcResponse = A2AJsonRpcResponse

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

function safeId(value: unknown, label: string, required = true): string {
  if (value === undefined || value === null || value === '') {
    if (required) invalidParams(`${label} is required`)
    return ''
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

function optionalMetadata(value: unknown, label: string): void {
  if (value === undefined || value === null) return
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
}

function validateStringList(
  value: unknown,
  label: string,
  maxEntries: number,
): void {
  if (value === undefined || value === null) return
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
}

function canonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return false
  }
  try {
    return Buffer.from(value, 'base64').toString('base64') === value
  } catch {
    return false
  }
}

function validateMessage(value: unknown): Record<string, unknown> {
  const message = asObject(value, 'message')
  safeId(message.messageId, 'message.messageId')
  if (message.role !== 'ROLE_USER' && message.role !== 1 && message.role !== 'user') {
    invalidParams('message.role must be ROLE_USER')
  }
  if (
    !Array.isArray(message.parts) ||
    message.parts.length === 0 ||
    message.parts.length > MAX_PARTS
  ) {
    invalidParams(`message.parts must contain between 1 and ${MAX_PARTS} parts`)
  }
  for (const [index, candidate] of message.parts.entries()) {
    const part = asObject(candidate, `message.parts[${index}]`)
    const keys = ['text', 'raw', 'url', 'data'].filter(key =>
      Object.prototype.hasOwnProperty.call(part, key),
    )
    if (keys.length !== 1) {
      invalidParams(
        `message.parts[${index}] must contain exactly one of text, raw, url, or data`,
      )
    }
    if (keys[0] === 'text' && (typeof part.text !== 'string' || part.text.length > 1_000_000)) {
      invalidParams(`message.parts[${index}].text must be a string`)
    }
    if (keys[0] === 'raw' && (typeof part.raw !== 'string' || !canonicalBase64(part.raw))) {
      invalidParams(`message.parts[${index}].raw must be canonical base64`)
    }
    if (keys[0] === 'url') {
      if (typeof part.url !== 'string' || part.url.length > 8_192) {
        invalidParams(`message.parts[${index}].url must be an absolute HTTP(S) URL`)
      }
      try {
        const url = new URL(part.url)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          throw new Error('unsafe URL')
        }
      } catch {
        invalidParams(`message.parts[${index}].url must be an absolute HTTP(S) URL`)
      }
    }
    optionalMetadata(part.metadata, `message.parts[${index}].metadata`)
  }
  safeId(message.contextId, 'message.contextId', false)
  safeId(message.taskId, 'message.taskId', false)
  optionalMetadata(message.metadata, 'message.metadata')
  validateStringList(message.extensions, 'message.extensions', MAX_EXTENSIONS)
  validateStringList(
    message.referenceTaskIds,
    'message.referenceTaskIds',
    MAX_REFERENCE_TASKS,
  )
  return message
}

export function validateA2AV1Message(value: unknown): void {
  validateMessage(value)
}

function parseNonNegativeInteger(value: unknown, label: string): number | undefined {
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
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const skill = (candidate as Record<string, unknown>).skill
    if (typeof skill === 'string' && skill.trim()) return skill.trim()
  }
  return 'coding-agent'
}

function promptFromRawMessage(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
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

export function toA2AV1Task(task: Task): A2AV1Task {
  return Task.toJSON(task) as A2AV1Task
}

function toA2AV1Message(message: Message): A2AV1Message {
  return Message.toJSON(message) as A2AV1Message
}

export class A2AV1ProtocolRuntime {
  readonly #runtime: A2AProtocolRuntime

  constructor(runtime: A2AProtocolRuntime) {
    this.#runtime = runtime
  }

  private context(
    identity: A2AProtocolIdentity,
    tenant: string,
    skill?: string,
  ) {
    return this.#runtime.context(
      namespaceA2AV1Identity(identity, tenant, skill),
      '1.0',
      tenant,
    )
  }

  async sendMessage(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<{ task: A2AV1Task } | { message: A2AV1Message }> {
    const request = asObject(value, 'SendMessageRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    validateMessage(request.message)
    optionalMetadata(request.metadata, 'metadata')
    const configuration =
      request.configuration === undefined || request.configuration === null
        ? {}
        : asObject(request.configuration, 'configuration')
    const historyLength = parseNonNegativeInteger(
      configuration.historyLength,
      'configuration.historyLength',
    )
    if (
      configuration.returnImmediately !== undefined &&
      typeof configuration.returnImmediately !== 'boolean'
    ) {
      invalidParams('configuration.returnImmediately must be a boolean')
    }
    if (configuration.acceptedOutputModes !== undefined) {
      validateStringList(
        configuration.acceptedOutputModes,
        'configuration.acceptedOutputModes',
        32,
      )
    }
    const params = SendMessageRequest.fromJSON({
      ...request,
      tenant,
      configuration: {
        ...configuration,
        ...(historyLength !== undefined ? { historyLength } : {}),
      },
    })
    const result = await this.#runtime.requestHandler().sendMessage(
      params,
      this.context(identity, tenant, requestedSkillFromObject(request)),
    )
    return 'id' in result
      ? { task: toA2AV1Task(result) }
      : { message: toA2AV1Message(result) }
  }

  async *sendMessageStream(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): AsyncGenerator<unknown, void, undefined> {
    const request = asObject(value, 'SendMessageRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    validateMessage(request.message)
    optionalMetadata(request.metadata, 'metadata')
    const params = SendMessageRequest.fromJSON({ ...request, tenant })
    const stream = this.#runtime.requestHandler().sendMessageStream(
      params,
      this.context(identity, tenant, requestedSkillFromObject(request)),
    )
    for await (const event of stream) yield StreamResponse.toJSON(event)
  }

  async getTask(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<A2AV1Task> {
    const request = asObject(value, 'GetTaskRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const params = GetTaskRequest.fromJSON({
      ...request,
      id: safeId(request.id, 'id'),
      tenant,
      historyLength: parseNonNegativeInteger(request.historyLength, 'historyLength'),
    })
    return toA2AV1Task(
      await this.#runtime.requestHandler().getTask(
        params,
        this.context(identity, tenant),
      ),
    )
  }

  async listTasks(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<A2AV1ListTasksResponse> {
    const request = asObject(value, 'ListTasksRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const pageSize = parseNonNegativeInteger(request.pageSize, 'pageSize') ?? 50
    if (pageSize < 1 || pageSize > 100) invalidParams('pageSize must be between 1 and 100')
    const historyLength = parseNonNegativeInteger(request.historyLength, 'historyLength')
    const status =
      request.status === undefined || request.status === ''
        ? TaskState.TASK_STATE_UNSPECIFIED
        : taskStateFromJSON(request.status)
    if (status === TaskState.UNRECOGNIZED) invalidParams('status is not a recognized TaskState')
    if (
      request.statusTimestampAfter !== undefined &&
      request.statusTimestampAfter !== '' &&
      (typeof request.statusTimestampAfter !== 'string' ||
        !Number.isFinite(Date.parse(request.statusTimestampAfter)))
    ) {
      invalidParams('statusTimestampAfter must be an ISO 8601 timestamp')
    }
    if (
      request.includeArtifacts !== undefined &&
      typeof request.includeArtifacts !== 'boolean'
    ) {
      invalidParams('includeArtifacts must be a boolean')
    }
    const params = ListTasksRequest.fromJSON({
      ...request,
      tenant,
      pageSize,
      status: taskStateToJSON(status),
      ...(historyLength !== undefined ? { historyLength } : {}),
    })
    const result: ListTasksResponse = await this.#runtime
      .requestHandler()
      .listTasks(params, this.context(identity, tenant))
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
    optionalMetadata(request.metadata, 'metadata')
    const params = CancelTaskRequest.fromJSON({
      ...request,
      id: safeId(request.id, 'id'),
      tenant,
    })
    return toA2AV1Task(
      await this.#runtime.requestHandler().cancelTask(
        params,
        this.context(identity, tenant),
      ),
    )
  }

  async createPushConfig(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<unknown> {
    const request = asObject(value, 'TaskPushNotificationConfig')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const params = TaskPushNotificationConfig.fromJSON({ ...request, tenant })
    return TaskPushNotificationConfig.toJSON(
      await this.#runtime.requestHandler().createTaskPushNotificationConfig(
        params,
        this.context(identity, tenant),
      ),
    )
  }

  async getPushConfig(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<unknown> {
    const request = asObject(value, 'GetTaskPushNotificationConfigRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const params = GetTaskPushNotificationConfigRequest.fromJSON({
      ...request,
      taskId: safeId(request.taskId, 'taskId'),
      id: safeId(request.id, 'id'),
      tenant,
    })
    return TaskPushNotificationConfig.toJSON(
      await this.#runtime.requestHandler().getTaskPushNotificationConfig(
        params,
        this.context(identity, tenant),
      ),
    )
  }

  async listPushConfigs(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<unknown> {
    const request = asObject(value, 'ListTaskPushNotificationConfigsRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const pageSize = parseNonNegativeInteger(request.pageSize, 'pageSize') ?? 50
    const params = ListTaskPushNotificationConfigsRequest.fromJSON({
      ...request,
      taskId: safeId(request.taskId, 'taskId'),
      pageSize,
      tenant,
    })
    const result = await this.#runtime.requestHandler().listTaskPushNotificationConfigs(
      params,
      this.context(identity, tenant),
    )
    return {
      configs: result.configs.map(config => TaskPushNotificationConfig.toJSON(config)),
      nextPageToken: result.nextPageToken,
    }
  }

  async deletePushConfig(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): Promise<Record<string, never>> {
    const request = asObject(value, 'DeleteTaskPushNotificationConfigRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const params = DeleteTaskPushNotificationConfigRequest.fromJSON({
      ...request,
      taskId: safeId(request.taskId, 'taskId'),
      id: safeId(request.id, 'id'),
      tenant,
    })
    await this.#runtime.requestHandler().deleteTaskPushNotificationConfig(
      params,
      this.context(identity, tenant),
    )
    return {}
  }

  async *subscribeToTask(
    value: unknown,
    identity: A2AProtocolIdentity,
    tenantOverride = '',
  ): AsyncGenerator<unknown, void, undefined> {
    const request = asObject(value, 'SubscribeToTaskRequest')
    const tenant = validateA2AV1Tenant(tenantOverride || request.tenant)
    const params = SubscribeToTaskRequest.fromJSON({
      ...request,
      id: safeId(request.id, 'id'),
      tenant,
    })
    const stream = this.#runtime.requestHandler().resubscribe(
      params,
      this.context(identity, tenant),
    )
    for await (const event of stream) yield StreamResponse.toJSON(event)
  }

  async handleJsonRpc(
    payload: {
      method: 'SendStreamingMessage' | 'SubscribeToTask'
      [key: string]: unknown
    },
    identity: A2AProtocolIdentity,
  ): Promise<AsyncGenerator<A2AJsonRpcResponse, void, undefined>>
  async handleJsonRpc(
    payload: unknown,
    identity: A2AProtocolIdentity,
  ): Promise<A2AJsonRpcResponse>
  async handleJsonRpc(
    payload: unknown,
    identity: A2AProtocolIdentity,
  ): Promise<
    A2AJsonRpcResponse | AsyncGenerator<A2AJsonRpcResponse, void, undefined>
  > {
    const inspection = inspectA2AV1Request(payload)
    if (
      inspection.method === 'SendMessage' ||
      inspection.method === 'SendStreamingMessage'
    ) {
      try {
        const request = asObject(payload, 'JSON-RPC request')
        const params = asObject(request.params, 'params')
        validateMessage(params.message)
        optionalMetadata(params.metadata, 'metadata')
      } catch (error) {
        const mapped =
          error instanceof A2AV1Error
            ? error
            : new A2AV1Error(-32602, 'Invalid message')
        return {
          jsonrpc: '2.0',
          id: inspection.id,
          error: {
            code: mapped.code,
            message: mapped.message,
            data: errorDetails(mapped),
          },
        }
      }
    }
    const scoped = namespaceA2AV1Identity(
      identity,
      inspection.tenant,
      inspection.method === 'SendMessage' ||
        inspection.method === 'SendStreamingMessage'
        ? inspection.skill
        : undefined,
    )
    return this.#runtime.handleV1(payload, scoped, inspection.tenant)
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
  if (error instanceof SDKError) {
    const status = restStatusFor(error)
    return {
      status,
      body: toRestErrorBody(error, status) as ReturnType<typeof a2aV1HttpError>['body'],
    }
  }
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
        code: mapped.code,
        status: statusName,
        message: mapped.message,
        details: errorDetails(mapped) ?? [],
      },
    },
  }
}

export function a2aV1JsonRpcError(error: unknown): unknown {
  return error instanceof A2AV1Error
    ? {
        code: error.code,
        message: error.message,
        data: errorDetails(error),
      }
    : toJsonRpcError(error)
}
