import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  Artifact,
  ListTasksRequest,
  ListTasksResponse,
  Message,
  Part,
  Task,
} from '@a2a-js/sdk'
import { AgentCard, Role, TaskState } from '@a2a-js/sdk'
import { RequestMalformedError, TaskNotFoundError } from '@a2a-js/sdk/errors'
import {
  AgentEvent,
  DefaultRequestHandler,
  JsonRpcTransportHandler,
  ServerCallContext,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
  type TaskStore,
  type User,
} from '@a2a-js/sdk/server'
import { LegacyJsonRpcTransportHandler } from '@a2a-js/sdk/compat/v0_3/server'
import {
  SecureA2APushNotificationSender,
  SecureA2APushNotificationStore,
} from './a2aPushNotifications.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { readPositiveInteger } from '../../utils/rollingRateLimiter.js'

const PROTOCOL_TASK_MANIFEST_VERSION = 1
const MAX_PROTOCOL_TASK_MANIFEST_BYTES = 16 * 1024 * 1024
const MAX_PERSISTED_PROTOCOL_TASKS = 1_000

type StoredProtocolTask = {
  owner: string
  skill: string
  task: Task
}

type ProtocolTaskManifest = {
  version: 1
  tasks: StoredProtocolTask[]
}

export type A2AProtocolIdentity = User & {
  scopes: string[]
  requestedSkill?: string
}

export type A2AProtocolRuntimeOptions = {
  cwd: string
  card: unknown
  dryRun?: boolean
  runPrompt?: A2APromptRunner
}

export type A2APromptRunner = (
  prompt: string,
  context: { cwd: string; signal: AbortSignal },
) => Promise<{ code: number; stdout: string; stderr: string }>

export type A2AProtocolInspection = {
  id: string | number | null
  method?: string
  prompt?: string
  skill: string
}

export type A2AProtocolTaskListParams = {
  contextId?: string
  status?: TaskState
  pageSize: number
  pageToken?: string
  historyLength?: number
  statusTimestampAfter?: string
  includeArtifacts: boolean
}

export type A2AProtocolTaskList = {
  tasks: Task[]
  nextPageToken: string
  pageSize: number
  totalSize: number
}

export type A2AJsonRpcResponse = {
  jsonrpc: string
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function protocolManifestPath(cwd: string): string {
  return join(cwd, '.ur', 'a2a', 'protocol-tasks.json')
}

function cloneTask(task: Task): Task {
  return structuredClone(task)
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const task = value as Partial<Task>
  return (
    typeof task.id === 'string' &&
    typeof task.contextId === 'string' &&
    Boolean(task.status) &&
    typeof task.status?.state === 'number' &&
    Array.isArray(task.artifacts) &&
    Array.isArray(task.history)
  )
}

const LEGACY_TASK_STATES: Record<string, TaskState> = {
  unknown: TaskState.TASK_STATE_UNSPECIFIED,
  submitted: TaskState.TASK_STATE_SUBMITTED,
  working: TaskState.TASK_STATE_WORKING,
  completed: TaskState.TASK_STATE_COMPLETED,
  failed: TaskState.TASK_STATE_FAILED,
  canceled: TaskState.TASK_STATE_CANCELED,
  'input-required': TaskState.TASK_STATE_INPUT_REQUIRED,
  rejected: TaskState.TASK_STATE_REJECTED,
  'auth-required': TaskState.TASK_STATE_AUTH_REQUIRED,
}

function migrateLegacyPart(value: unknown): Part | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const part = value as Record<string, unknown>
  const metadata =
    part.metadata && typeof part.metadata === 'object' && !Array.isArray(part.metadata)
      ? structuredClone(part.metadata as Record<string, unknown>)
      : undefined
  if (part.kind === 'text' && typeof part.text === 'string') {
    return { ...textPart(part.text), metadata }
  }
  if (part.kind === 'data' && Object.prototype.hasOwnProperty.call(part, 'data')) {
    return { ...dataPart(structuredClone(part.data)), metadata }
  }
  if (part.kind === 'file' && part.file && typeof part.file === 'object') {
    const file = part.file as Record<string, unknown>
    const common = {
      metadata,
      filename: typeof file.name === 'string' ? file.name : '',
      mediaType: typeof file.mimeType === 'string' ? file.mimeType : '',
    }
    if (typeof file.bytes === 'string') {
      return {
        ...common,
        content: { $case: 'raw', value: Buffer.from(file.bytes, 'base64') },
      }
    }
    if (typeof file.uri === 'string') {
      return {
        ...common,
        content: { $case: 'url', value: file.uri },
      }
    }
  }
  return undefined
}

function migrateLegacyMessage(value: unknown): Message | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (
    message.kind !== 'message' ||
    typeof message.messageId !== 'string' ||
    !Array.isArray(message.parts)
  ) {
    return undefined
  }
  const parts = message.parts.map(migrateLegacyPart)
  if (parts.some(part => !part)) return undefined
  return {
    messageId: message.messageId,
    contextId: typeof message.contextId === 'string' ? message.contextId : '',
    taskId: typeof message.taskId === 'string' ? message.taskId : '',
    role:
      message.role === 'agent' ? Role.ROLE_AGENT : Role.ROLE_USER,
    parts: parts as Part[],
    metadata:
      message.metadata &&
      typeof message.metadata === 'object' &&
      !Array.isArray(message.metadata)
        ? structuredClone(message.metadata as Record<string, unknown>)
        : undefined,
    extensions: Array.isArray(message.extensions)
      ? message.extensions.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [],
    referenceTaskIds: Array.isArray(message.referenceTaskIds)
      ? message.referenceTaskIds.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [],
  }
}

function migrateLegacyTask(value: unknown): Task | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const task = value as Record<string, unknown>
  const status =
    task.status && typeof task.status === 'object' && !Array.isArray(task.status)
      ? (task.status as Record<string, unknown>)
      : undefined
  if (
    task.kind !== 'task' ||
    typeof task.id !== 'string' ||
    typeof task.contextId !== 'string' ||
    !status ||
    typeof status.state !== 'string' ||
    LEGACY_TASK_STATES[status.state] === undefined
  ) {
    return undefined
  }
  const artifacts = Array.isArray(task.artifacts)
    ? task.artifacts.flatMap(candidate => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          return []
        }
        const artifact = candidate as Record<string, unknown>
        if (typeof artifact.artifactId !== 'string' || !Array.isArray(artifact.parts)) {
          return []
        }
        const parts = artifact.parts.map(migrateLegacyPart)
        if (parts.some(part => !part)) return []
        return [
          {
            artifactId: artifact.artifactId,
            name: typeof artifact.name === 'string' ? artifact.name : '',
            description:
              typeof artifact.description === 'string' ? artifact.description : '',
            parts: parts as Part[],
            metadata:
              artifact.metadata &&
              typeof artifact.metadata === 'object' &&
              !Array.isArray(artifact.metadata)
                ? structuredClone(artifact.metadata as Record<string, unknown>)
                : undefined,
            extensions: Array.isArray(artifact.extensions)
              ? artifact.extensions.filter(
                  (entry): entry is string => typeof entry === 'string',
                )
              : [],
          },
        ]
      })
    : []
  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: LEGACY_TASK_STATES[status.state]!,
      message: migrateLegacyMessage(status.message),
      timestamp: typeof status.timestamp === 'string' ? status.timestamp : undefined,
    },
    artifacts,
    history: Array.isArray(task.history)
      ? task.history.flatMap(message => migrateLegacyMessage(message) ?? [])
      : [],
    metadata:
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? structuredClone(task.metadata as Record<string, unknown>)
        : undefined,
  }
}

function normalizeStoredProtocolTask(value: unknown): StoredProtocolTask | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entry = value as Partial<StoredProtocolTask>
  if (!(
    typeof entry.owner === 'string' &&
    entry.owner.length <= 256 &&
    typeof entry.skill === 'string' &&
    entry.skill.length > 0 &&
    entry.skill.length <= 128
  )) {
    return undefined
  }
  const task = isTask(entry.task)
    ? entry.task
    : migrateLegacyTask(entry.task)
  return task ? { owner: entry.owner, skill: entry.skill, task } : undefined
}

function loadProtocolTaskManifest(cwd: string): ProtocolTaskManifest {
  const path = protocolManifestPath(cwd)
  if (!existsSync(path)) {
    return { version: PROTOCOL_TASK_MANIFEST_VERSION, tasks: [] }
  }
  try {
    if (statSync(path).size > MAX_PROTOCOL_TASK_MANIFEST_BYTES) {
      return { version: PROTOCOL_TASK_MANIFEST_VERSION, tasks: [] }
    }
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProtocolTaskManifest>
    if (!Array.isArray(parsed.tasks)) {
      return { version: PROTOCOL_TASK_MANIFEST_VERSION, tasks: [] }
    }
    return {
      version: PROTOCOL_TASK_MANIFEST_VERSION,
      tasks: parsed.tasks
        .map(normalizeStoredProtocolTask)
        .filter((entry): entry is StoredProtocolTask => Boolean(entry))
        .slice(-MAX_PERSISTED_PROTOCOL_TASKS),
    }
  } catch {
    // A corrupt local cache must not prevent the opt-in sidecar from starting.
    return { version: PROTOCOL_TASK_MANIFEST_VERSION, tasks: [] }
  }
}

function saveProtocolTaskManifest(
  cwd: string,
  entries: Iterable<StoredProtocolTask>,
): void {
  const destination = protocolManifestPath(cwd)
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  const tasks = [...entries].slice(-MAX_PERSISTED_PROTOCOL_TASKS)
  try {
    writeFileSync(
      temporary,
      `${JSON.stringify(
        { version: PROTOCOL_TASK_MANIFEST_VERSION, tasks },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    )
    renameSync(temporary, destination)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

function ownerFromContext(context?: ServerCallContext): string {
  return context?.user?.userName || 'local'
}

function identityFromContext(
  context?: ServerCallContext,
): A2AProtocolIdentity | undefined {
  const user = context?.user as A2AProtocolIdentity | undefined
  return user && Array.isArray(user.scopes) ? user : undefined
}

function identityAllowsSkill(
  identity: A2AProtocolIdentity | undefined,
  skill: string,
): boolean {
  return Boolean(
    identity &&
      (identity.scopes.includes('*') || identity.scopes.includes(skill)),
  )
}

/**
 * Durable task storage with caller isolation. The official SDK supplies the
 * protocol semantics; this store ensures a delegated caller cannot enumerate,
 * continue, cancel, or reference another subject's task by guessing its id.
 */
class PersistentA2ATaskStore implements TaskStore {
  readonly #cwd: string
  readonly #tasks = new Map<string, StoredProtocolTask>()

  constructor(cwd: string) {
    this.#cwd = cwd
    for (const entry of loadProtocolTaskManifest(cwd).tasks) {
      this.#tasks.set(entry.task.id, entry)
    }
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    const entry = this.#tasks.get(taskId)
    if (
      !entry ||
      entry.owner !== ownerFromContext(context) ||
      !identityAllowsSkill(identityFromContext(context), entry.skill)
    ) {
      return undefined
    }
    return cloneTask(entry.task)
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    const owner = ownerFromContext(context)
    const identity = identityFromContext(context)
    const existing = this.#tasks.get(task.id)
    if (existing && existing.owner !== owner) {
      throw new TaskNotFoundError(`Task ${task.id} was not found`)
    }
    const skill = existing?.skill ?? identity?.requestedSkill ?? 'coding-agent'
    if (!identityAllowsSkill(identity, skill)) {
      throw new TaskNotFoundError(`Task ${task.id} was not found`)
    }
    // Refresh insertion order so retention removes the oldest completed tasks.
    this.#tasks.delete(task.id)
    this.#tasks.set(task.id, { owner, skill, task: cloneTask(task) })
    while (this.#tasks.size > MAX_PERSISTED_PROTOCOL_TASKS) {
      const oldest = this.#tasks.keys().next().value as string | undefined
      if (!oldest) break
      this.#tasks.delete(oldest)
    }
    saveProtocolTaskManifest(this.#cwd, this.#tasks.values())
  }

  async listVisible(
    params: A2AProtocolTaskListParams,
    context: ServerCallContext,
  ): Promise<A2AProtocolTaskList> {
    const owner = ownerFromContext(context)
    const identity = identityFromContext(context)
    const filterKey = createHash('sha256')
      .update(
        JSON.stringify({
          owner,
          contextId: params.contextId ?? null,
          status: params.status ?? null,
          historyLength: params.historyLength ?? null,
          statusTimestampAfter: params.statusTimestampAfter ?? null,
          includeArtifacts: params.includeArtifacts,
        }),
      )
      .digest('base64url')

    const visible = [...this.#tasks.values()]
      .filter(entry => {
        if (
          entry.owner !== owner ||
          !identityAllowsSkill(identity, entry.skill)
        ) {
          return false
        }
        if (params.contextId && entry.task.contextId !== params.contextId) {
          return false
        }
        if (params.status && entry.task.status.state !== params.status) {
          return false
        }
        if (params.statusTimestampAfter) {
          const timestamp = entry.task.status?.timestamp
          if (
            !timestamp ||
            Date.parse(timestamp) < Date.parse(params.statusTimestampAfter)
          ) {
            return false
          }
        }
        return true
      })
      .sort(
        (a, b) =>
          String(b.task.status?.timestamp).localeCompare(
            String(a.task.status?.timestamp),
          ) || a.task.id.localeCompare(b.task.id),
      )

    let start = 0
    if (params.pageToken) {
      let parsed: unknown
      try {
        if (
          params.pageToken.length > 4_096 ||
          !/^[0-9A-Za-z_-]+$/u.test(params.pageToken)
        ) {
          throw new Error('invalid token encoding')
        }
        parsed = JSON.parse(
          Buffer.from(params.pageToken, 'base64url').toString('utf8'),
        )
      } catch {
        throw new RequestMalformedError('invalid ListTasks pageToken')
      }
      const cursor = parsed as {
        version?: unknown
        filter?: unknown
        timestamp?: unknown
        taskId?: unknown
      }
      if (
        !cursor ||
        cursor.version !== 1 ||
        cursor.filter !== filterKey ||
        typeof cursor.timestamp !== 'string' ||
        typeof cursor.taskId !== 'string'
      ) {
        throw new RequestMalformedError('invalid ListTasks pageToken')
      }
      const cursorTimestamp = cursor.timestamp
      const cursorTaskId = cursor.taskId
      const exact = visible.findIndex(
        entry =>
            String(entry.task.status?.timestamp) === cursorTimestamp &&
          entry.task.id === cursorTaskId,
      )
      if (exact >= 0) {
        start = exact + 1
      } else {
        start = visible.findIndex(
          entry =>
            String(entry.task.status?.timestamp).localeCompare(cursorTimestamp) <
              0 ||
            (String(entry.task.status?.timestamp) === cursorTimestamp &&
              entry.task.id.localeCompare(cursorTaskId) > 0),
        )
        if (start < 0) start = visible.length
      }
    }

    const selected = visible.slice(start, start + params.pageSize)
    const tasks = selected.map(entry => {
      const task = cloneTask(entry.task)
      if (!params.includeArtifacts) task.artifacts = []
      if (params.historyLength === 0) {
        task.history = []
      } else if (
        params.historyLength !== undefined &&
        task.history &&
        task.history.length > params.historyLength
      ) {
        task.history = task.history.slice(-params.historyLength)
      }
      return task
    })
    const last = selected.at(-1)
    const hasMore = start + selected.length < visible.length
    return {
      tasks,
      nextPageToken:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                version: 1,
                filter: filterKey,
                timestamp: String(last.task.status?.timestamp),
                taskId: last.task.id,
              }),
            ).toString('base64url')
          : '',
      pageSize: params.pageSize,
      totalSize: visible.length,
    }
  }

  async list(
    params: ListTasksRequest,
    context: ServerCallContext,
  ): Promise<ListTasksResponse> {
    return this.listVisible(
      {
        ...(params.contextId ? { contextId: params.contextId } : {}),
        ...(params.status !== TaskState.TASK_STATE_UNSPECIFIED
          ? { status: params.status }
          : {}),
        pageSize: params.pageSize ?? 50,
        ...(params.pageToken ? { pageToken: params.pageToken } : {}),
        ...(params.historyLength !== undefined
          ? { historyLength: params.historyLength }
          : {}),
        ...(params.statusTimestampAfter
          ? { statusTimestampAfter: params.statusTimestampAfter }
          : {}),
        includeArtifacts: params.includeArtifacts === true,
      },
      context,
    )
  }
}

function headlessCommand(): string[] {
  return [
    process.execPath,
    process.argv[1] ?? '',
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    'dontAsk',
  ]
}

function promptPartText(part: unknown): string | undefined {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return undefined
  const value = part as Record<string, unknown>
  const content = value.content
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const typed = content as { $case?: unknown; value?: unknown }
    if (typed.$case === 'text' && typeof typed.value === 'string') {
      return typed.value
    }
    if (typed.$case === 'data' && typed.value !== undefined) {
      try {
        return JSON.stringify(typed.value)
      } catch {
        return undefined
      }
    }
  }
  // The request inspectors also accept the public ProtoJSON form before the
  // SDK has decoded it.
  if (typeof value.text === 'string') return value.text
  if (Object.prototype.hasOwnProperty.call(value, 'data')) {
    try {
      return JSON.stringify(value.data)
    } catch {
      return undefined
    }
  }
  // Explicit v0.3 compatibility requests use the older discriminated shape.
  if (value.kind === 'text' && typeof value.text === 'string') {
    return value.text
  }
  if (value.kind === 'data' && value.data !== undefined) {
    try {
      return JSON.stringify(value.data)
    } catch {
      return undefined
    }
  }
  return undefined
}

function textPrompt(message: Message): string {
  return message.parts
    .map(promptPartText)
    .filter((part): part is string => part !== undefined)
    .join('\n')
}

function requestedSkill(payload: Record<string, unknown>): string {
  const params = payload.params
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return 'coding-agent'
  }
  const typedParams = params as Record<string, unknown>
  const message = typedParams.message
  const messageMetadata =
    message && typeof message === 'object' && !Array.isArray(message)
      ? (message as Record<string, unknown>).metadata
      : undefined
  const candidates = [
    typedParams.metadata,
    messageMetadata,
  ]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue
    }
    const skill = (candidate as Record<string, unknown>).skill
    if (typeof skill === 'string' && skill.trim()) return skill.trim()
  }
  return 'coding-agent'
}

export function inspectA2AProtocolRequest(
  payload: unknown,
): A2AProtocolInspection {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { id: null, skill: 'coding-agent' }
  }
  const request = payload as Record<string, unknown>
  const id =
    typeof request.id === 'string' || typeof request.id === 'number'
      ? request.id
      : null
  const method = typeof request.method === 'string' ? request.method : undefined
  const params = request.params
  let prompt: string | undefined
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const message = (params as Record<string, unknown>).message
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      const parts = (message as Record<string, unknown>).parts
      if (Array.isArray(parts)) {
        prompt = parts
          .map(promptPartText)
          .filter((part): part is string => part !== undefined)
          .join('\n')
      }
    }
  }
  return { id, method, prompt, skill: requestedSkill(request) }
}

function outputText(stdout: string, stderr: string, code: number): string {
  const parts = [stdout.trim()]
  if (code !== 0 && stderr.trim()) parts.push(stderr.trim())
  const output = parts.filter(Boolean).join('\n\n')
  return output || (code === 0 ? 'UR completed the task.' : 'UR task failed.')
}

type A2AConformanceScenario =
  | 'artifact-text'
  | 'artifact-file'
  | 'artifact-file-url'
  | 'artifact-data'
  | 'message-response'
  | 'input-required'

function conformanceScenario(messageId: string): A2AConformanceScenario | undefined {
  if (process.env.UR_A2A_CONFORMANCE_MODE !== 'true') return undefined
  for (const scenario of [
    'artifact-file-url',
    'artifact-text',
    'artifact-file',
    'artifact-data',
    'message-response',
    'input-required',
  ] as const) {
    if (messageId.startsWith(`tck-${scenario}-`)) return scenario
  }
  return undefined
}

function conformanceArtifact(
  scenario: Exclude<A2AConformanceScenario, 'message-response' | 'input-required'>,
): Artifact {
  const artifactId = randomUUID()
  switch (scenario) {
    case 'artifact-text':
      return {
        artifactId,
        name: 'TCK text artifact',
        description: '',
        parts: [textPart('Generated text content')],
        metadata: undefined,
        extensions: [],
      }
    case 'artifact-file':
      return {
        artifactId,
        name: 'TCK file artifact',
        description: '',
        parts: [
          {
            content: {
              $case: 'raw',
              value: Buffer.from('Generated file content'),
            },
            filename: 'output.txt',
            mediaType: 'text/plain',
            metadata: undefined,
          },
        ],
        metadata: undefined,
        extensions: [],
      }
    case 'artifact-file-url':
      return {
        artifactId,
        name: 'TCK file URL artifact',
        description: '',
        parts: [
          {
            content: {
              $case: 'url',
              value: 'https://example.com/output.txt',
            },
            filename: 'output.txt',
            mediaType: 'text/plain',
            metadata: undefined,
          },
        ],
        metadata: undefined,
        extensions: [],
      }
    case 'artifact-data':
      return {
        artifactId,
        name: 'TCK data artifact',
        description: '',
        parts: [dataPart({ key: 'value', count: 42 })],
        metadata: undefined,
        extensions: [],
      }
  }
}

function textPart(text: string): Part {
  return {
    content: { $case: 'text', value: text },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  }
}

function dataPart(data: unknown): Part {
  return {
    content: { $case: 'data', value: data },
    metadata: undefined,
    filename: '',
    mediaType: 'application/json',
  }
}

function agentMessage(
  messageId: string,
  contextId: string,
  text: string,
  taskId = '',
): Message {
  return {
    messageId,
    contextId,
    taskId,
    role: Role.ROLE_AGENT,
    parts: [textPart(text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  }
}

class UrA2AExecutor implements AgentExecutor {
  readonly #options: A2AProtocolRuntimeOptions
  readonly #controllers = new Map<string, AbortController>()
  readonly #contextIds = new Map<string, string>()
  readonly #owners = new Map<string, number>()

  constructor(options: A2AProtocolRuntimeOptions) {
    this.#options = options
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { taskId, contextId, userMessage } = requestContext
    const scenario = conformanceScenario(userMessage.messageId)
    if (scenario === 'message-response') {
      eventBus.publish(
        AgentEvent.message(
          agentMessage(randomUUID(), contextId, 'Direct message response'),
        ),
      )
      eventBus.finished()
      return
    }
    if (scenario === 'input-required') {
      const status = {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        timestamp: new Date().toISOString(),
        message: agentMessage(
          randomUUID(),
          contextId,
          'Additional input is required to continue.',
          taskId,
        ),
      }
      eventBus.publish(
        AgentEvent.task({
          id: taskId,
          contextId,
          status,
          artifacts: [],
          history: [userMessage],
          metadata: undefined,
        }),
      )
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status,
          metadata: undefined,
        }),
      )
      eventBus.finished()
      return
    }
    const owner = requestContext.context?.user?.userName || 'local'
    const maxActive = readPositiveInteger(
      process.env.UR_A2A_MAX_ACTIVE_TASKS,
      16,
      500,
    )
    const maxActivePerOwner = readPositiveInteger(
      process.env.UR_A2A_MAX_ACTIVE_TASKS_PER_OWNER,
      4,
      100,
    )
    if (
      this.#controllers.size >= maxActive ||
      (this.#owners.get(owner) ?? 0) >= maxActivePerOwner
    ) {
      const rejected = {
        state: TaskState.TASK_STATE_REJECTED,
        timestamp: new Date().toISOString(),
        message: agentMessage(
          randomUUID(),
          contextId,
          'A2A active-task admission limit reached; retry later.',
          taskId,
        ),
      }
      eventBus.publish(
        AgentEvent.task({
          id: taskId,
          contextId,
          status: rejected,
          artifacts: [],
          history: [userMessage],
          metadata: undefined,
        }),
      )
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: rejected,
          metadata: undefined,
        }),
      )
      eventBus.finished()
      return
    }
    const controller = new AbortController()
    this.#controllers.set(taskId, controller)
    this.#contextIds.set(taskId, contextId)
    this.#owners.set(owner, (this.#owners.get(owner) ?? 0) + 1)
    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        artifacts: [],
        history: [userMessage],
        metadata: undefined,
      }),
    )

    try {
      const command = headlessCommand()
      const prompt = textPrompt(userMessage)
      const result = this.#options.dryRun
        ? {
            code: 0,
            stdout: JSON.stringify({ dryRun: true, command }),
            stderr: '',
          }
        : this.#options.runPrompt
          ? await this.#options.runPrompt(prompt, {
              cwd: this.#options.cwd,
              signal: controller.signal,
            })
          : await execFileNoThrowWithCwd(command[0]!, command.slice(1), {
              cwd: this.#options.cwd,
              timeout: readPositiveInteger(
                process.env.UR_A2A_TASK_TIMEOUT_MS,
                30 * 60 * 1000,
                2 * 60 * 60 * 1000,
              ),
              preserveOutputOnError: true,
              maxBuffer: readPositiveInteger(
                process.env.UR_A2A_MAX_OUTPUT_BYTES,
                2_000_000,
                8_000_000,
              ),
              stdin: 'pipe',
              input: prompt,
              abortSignal: controller.signal,
            })
      if (controller.signal.aborted) return

      const artifactScenario = scenario
      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          append: false,
          lastChunk: true,
          metadata: undefined,
          artifact: artifactScenario
            ? conformanceArtifact(artifactScenario)
            : {
                artifactId: randomUUID(),
                name: 'UR result',
                description: 'Final output produced by UR for this task.',
                parts: [
                  textPart(
                    outputText(result.stdout, result.stderr, result.code),
                  ),
                ],
                metadata: undefined,
                extensions: [],
              },
        }),
      )

      const state =
        result.code === 0
          ? TaskState.TASK_STATE_COMPLETED
          : TaskState.TASK_STATE_FAILED
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          metadata: undefined,
          status: {
            state,
            timestamp: new Date().toISOString(),
            message: agentMessage(
              randomUUID(),
              contextId,
              outputText(result.stdout, result.stderr, result.code),
              taskId,
            ),
          },
        }),
      )
    } finally {
      this.#controllers.delete(taskId)
      this.#contextIds.delete(taskId)
      const remaining = (this.#owners.get(owner) ?? 1) - 1
      if (remaining > 0) this.#owners.set(owner, remaining)
      else this.#owners.delete(owner)
      eventBus.finished()
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    this.#controllers.get(taskId)?.abort(new Error('A2A task canceled'))
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: this.#contextIds.get(taskId) ?? taskId,
        metadata: undefined,
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
      }),
    )
    eventBus.finished()
  }
}

export class A2AProtocolRuntime {
  readonly #v1Transport: JsonRpcTransportHandler
  readonly #legacyTransport: LegacyJsonRpcTransportHandler
  readonly #requestHandler: DefaultRequestHandler
  readonly #store: PersistentA2ATaskStore

  constructor(options: A2AProtocolRuntimeOptions) {
    this.#store = new PersistentA2ATaskStore(options.cwd)
    const pushStore = new SecureA2APushNotificationStore()
    const pushSender = new SecureA2APushNotificationSender(pushStore)
    this.#requestHandler = new DefaultRequestHandler(
      AgentCard.fromJSON(options.card),
      this.#store,
      new UrA2AExecutor(options),
      undefined,
      pushStore,
      pushSender,
    )
    this.#v1Transport = new JsonRpcTransportHandler(this.#requestHandler)
    this.#legacyTransport = new LegacyJsonRpcTransportHandler(
      this.#requestHandler,
    )
  }

  async handle(
    payload: unknown,
    identity: A2AProtocolIdentity,
  ): Promise<
    A2AJsonRpcResponse | AsyncGenerator<A2AJsonRpcResponse, void, undefined>
  > {
    return this.handleLegacy(payload, identity)
  }

  async handleLegacy(
    payload: unknown,
    identity: A2AProtocolIdentity,
  ): Promise<
    A2AJsonRpcResponse | AsyncGenerator<A2AJsonRpcResponse, void, undefined>
  > {
    return this.#legacyTransport.handle(
      payload as string | Record<string, unknown>,
      this.context(identity, '0.3'),
    ) as Promise<
      A2AJsonRpcResponse | AsyncGenerator<A2AJsonRpcResponse, void, undefined>
    >
  }

  async handleV1(
    payload: unknown,
    identity: A2AProtocolIdentity,
    tenant = '',
  ): Promise<
    A2AJsonRpcResponse | AsyncGenerator<A2AJsonRpcResponse, void, undefined>
  > {
    return this.#v1Transport.handle(
      payload as string | Record<string, unknown>,
      this.context(identity, '1.0', tenant),
    ) as Promise<
      A2AJsonRpcResponse | AsyncGenerator<A2AJsonRpcResponse, void, undefined>
    >
  }

  requestHandler(): DefaultRequestHandler {
    return this.#requestHandler
  }

  context(
    identity: A2AProtocolIdentity,
    requestedVersion = '1.0',
    tenant = '',
  ): ServerCallContext {
    return new ServerCallContext({
      user: identity,
      requestedVersion,
      ...(tenant ? { tenant } : {}),
    })
  }

  async listTasks(
    params: A2AProtocolTaskListParams,
    identity: A2AProtocolIdentity,
  ): Promise<A2AProtocolTaskList> {
    return this.#store.listVisible(
      params,
      this.context(identity),
    )
  }
}
