import { randomUUID } from 'node:crypto'
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
import type { AgentCard, JSONRPCResponse, Message, Task } from '@a2a-js/sdk'
import {
  A2AError,
  DefaultRequestHandler,
  JsonRpcTransportHandler,
  ServerCallContext,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
  type TaskStore,
  type User,
} from '@a2a-js/sdk/server'
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
  card: AgentCard
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
    task.kind === 'task' &&
    typeof task.id === 'string' &&
    typeof task.contextId === 'string' &&
    Boolean(task.status) &&
    typeof task.status?.state === 'string'
  )
}

function isStoredProtocolTask(value: unknown): value is StoredProtocolTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Partial<StoredProtocolTask>
  return (
    typeof entry.owner === 'string' &&
    entry.owner.length <= 256 &&
    typeof entry.skill === 'string' &&
    entry.skill.length > 0 &&
    entry.skill.length <= 128 &&
    isTask(entry.task)
  )
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
      tasks: parsed.tasks.filter(isStoredProtocolTask).slice(-MAX_PERSISTED_PROTOCOL_TASKS),
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

  async load(taskId: string, context?: ServerCallContext): Promise<Task | undefined> {
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

  async save(task: Task, context?: ServerCallContext): Promise<void> {
    const owner = ownerFromContext(context)
    const identity = identityFromContext(context)
    const existing = this.#tasks.get(task.id)
    if (existing && existing.owner !== owner) {
      throw A2AError.taskNotFound(task.id)
    }
    const skill = existing?.skill ?? identity?.requestedSkill ?? 'coding-agent'
    if (!identityAllowsSkill(identity, skill)) {
      throw A2AError.taskNotFound(task.id)
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
        state: 'rejected' as const,
        timestamp: new Date().toISOString(),
        message: {
          kind: 'message' as const,
          role: 'agent' as const,
          messageId: randomUUID(),
          taskId,
          contextId,
          parts: [
            {
              kind: 'text' as const,
              text: 'A2A active-task admission limit reached; retry later.',
            },
          ],
        },
      }
      eventBus.publish({
        kind: 'task',
        id: taskId,
        contextId,
        status: rejected,
        history: [userMessage],
      })
      eventBus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        final: true,
        status: rejected,
      })
      eventBus.finished()
      return
    }
    const controller = new AbortController()
    this.#controllers.set(taskId, controller)
    this.#contextIds.set(taskId, contextId)
    this.#owners.set(owner, (this.#owners.get(owner) ?? 0) + 1)
    eventBus.publish({
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'working', timestamp: new Date().toISOString() },
      history: [userMessage],
    })

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

      const state = result.code === 0 ? 'completed' : 'failed'
      eventBus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        final: true,
        status: {
          state,
          timestamp: new Date().toISOString(),
          message: {
            kind: 'message',
            role: 'agent',
            messageId: randomUUID(),
            taskId,
            contextId,
            parts: [
              {
                kind: 'text',
                text: outputText(result.stdout, result.stderr, result.code),
              },
            ],
          },
        },
      })
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
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId: this.#contextIds.get(taskId) ?? taskId,
      final: true,
      status: {
        state: 'canceled',
        timestamp: new Date().toISOString(),
      },
    })
    eventBus.finished()
  }
}

function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<JSONRPCResponse> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value
  )
}

export class A2AProtocolRuntime {
  readonly #transport: JsonRpcTransportHandler

  constructor(options: A2AProtocolRuntimeOptions) {
    const requestHandler = new DefaultRequestHandler(
      options.card,
      new PersistentA2ATaskStore(options.cwd),
      new UrA2AExecutor(options),
    )
    this.#transport = new JsonRpcTransportHandler(requestHandler)
  }

  async handle(
    payload: unknown,
    identity: A2AProtocolIdentity,
  ): Promise<JSONRPCResponse> {
    const result = await this.#transport.handle(
      payload,
      new ServerCallContext(undefined, identity),
    )
    if (isAsyncIterable(result)) {
      const inspected = inspectA2AProtocolRequest(payload)
      return {
        jsonrpc: '2.0',
        id: inspected.id,
        error: A2AError.unsupportedOperation(
          'streaming is not enabled by this agent',
        ).toJSONRPCError(),
      }
    }
    return result
  }
}
