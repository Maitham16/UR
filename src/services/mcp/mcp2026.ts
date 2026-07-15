import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

export const MCP_2026_PROTOCOL_VERSION = '2026-07-28'
export const MCP_TASKS_EXTENSION = 'io.modelcontextprotocol/tasks'
export const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui'
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'
export const UR_MCP_APP_URI = 'ui://ur-agent/overview.html'
export const UR_MCP_OVERVIEW_TOOL = 'ur.agent.overview'
export const UR_MCP_ASYNC_TOOL = 'ur.async.call'

const TASK_MANIFEST_VERSION = 1
const MAX_TASKS = 1_000
const MAX_TASK_MANIFEST_BYTES = 32 * 1024 * 1024
const MAX_TASK_RESULT_BYTES = 2 * 1024 * 1024
const DEFAULT_TASK_TTL_MS = 24 * 60 * 60 * 1_000
const DEFAULT_POLL_INTERVAL_MS = 1_000
const MAX_CUSTOM_HEADER_COUNT = 64
const MAX_CUSTOM_HEADER_BYTES = 64 * 1024
const HTTP_FIELD_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u
const BASE64_SENTINEL = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/u

export type Mcp2026JsonRpcId = string | number | null

export type Mcp2026JsonRpcResponse = {
  jsonrpc: '2.0'
  id: Mcp2026JsonRpcId
  result?: Record<string, unknown>
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export type Mcp2026Tool = {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
  [key: string]: unknown
}

export type Mcp2026ToolResult = {
  content: unknown[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
  [key: string]: unknown
}

export type Mcp2026ToolBackend = {
  listTools: () => Promise<{ tools: Mcp2026Tool[] }>
  callTool: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<Mcp2026ToolResult>
}

export type Mcp2026RequestContext = {
  owner: string
  clientCapabilities: Record<string, unknown>
  signal: AbortSignal
}

export type Mcp2026TaskStatus =
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type Mcp2026Task = {
  taskId: string
  status: Mcp2026TaskStatus
  statusMessage?: string
  createdAt: string
  lastUpdatedAt: string
  ttlMs: number | null
  pollIntervalMs?: number
  inputRequests?: Record<string, Record<string, unknown>>
  result?: Record<string, unknown>
  error?: Record<string, unknown>
}

type StoredMcp2026Task = {
  owner: string
  task: Mcp2026Task
}

type Mcp2026TaskManifest = {
  version: 1
  tasks: StoredMcp2026Task[]
}

export class Mcp2026Error extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'Mcp2026Error'
    this.code = code
    this.data = data
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeString(
  value: unknown,
  label: string,
  maxLength = 256,
): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > maxLength ||
    value.includes('\0')
  ) {
    throw new Mcp2026Error(
      -32602,
      `${label} must be a non-empty safe string of at most ${maxLength} characters`,
    )
  }
  return value
}

function cloneBoundedRecord(
  value: unknown,
  label: string,
  maxBytes: number,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Mcp2026Error(-32602, `${label} must be an object`)
  }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Mcp2026Error(-32602, `${label} must be JSON serializable`)
  }
  if (Buffer.byteLength(serialized) > maxBytes) {
    throw new Mcp2026Error(-32602, `${label} exceeds the ${maxBytes}-byte limit`)
  }
  return JSON.parse(serialized) as Record<string, unknown>
}

function isTask(value: unknown): value is Mcp2026Task {
  if (!isRecord(value)) return false
  const createdAt = Date.parse(String(value.createdAt))
  const lastUpdatedAt = Date.parse(String(value.lastUpdatedAt))
  return (
    typeof value.taskId === 'string' &&
    ['working', 'input_required', 'completed', 'failed', 'cancelled'].includes(
      String(value.status),
    ) &&
    typeof value.createdAt === 'string' &&
    typeof value.lastUpdatedAt === 'string' &&
    Number.isFinite(createdAt) &&
    Number.isFinite(lastUpdatedAt) &&
    (value.ttlMs === null ||
      (typeof value.ttlMs === 'number' &&
        Number.isSafeInteger(value.ttlMs) &&
        value.ttlMs >= 0))
  )
}

function taskManifestPath(cwd: string): string {
  return join(cwd, '.ur', 'mcp-2026', 'tasks.json')
}

function quarantineTaskManifest(path: string): string {
  const destination = `${path}.corrupt.${new Date()
    .toISOString()
    .replaceAll(/[:.]/g, '-')}.${randomUUID()}`
  renameSync(path, destination)
  chmodSync(destination, 0o600)
  return destination
}

function assertNotSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`Refusing to use symlinked MCP task state path: ${path}`)
  }
}

function prepareTaskDirectory(cwd: string): void {
  const urDir = join(cwd, '.ur')
  const mcpDir = join(urDir, 'mcp-2026')
  assertNotSymlink(urDir)
  mkdirSync(urDir, { recursive: true, mode: 0o700 })
  assertNotSymlink(urDir)
  chmodSync(urDir, 0o700)
  assertNotSymlink(mcpDir)
  mkdirSync(mcpDir, { recursive: true, mode: 0o700 })
  assertNotSymlink(mcpDir)
  chmodSync(mcpDir, 0o700)
}

function taskExpired(task: Mcp2026Task, at = Date.now()): boolean {
  return (
    task.ttlMs !== null &&
    at >= Date.parse(task.createdAt) + task.ttlMs
  )
}

class DurableMcp2026TaskStore {
  readonly #cwd: string
  readonly #tasks = new Map<string, StoredMcp2026Task>()
  #mutationTail = Promise.resolve()

  constructor(cwd: string) {
    this.#cwd = cwd
    const manifest = this.#load()
    let changed = false
    for (const entry of manifest.tasks) {
      if (taskExpired(entry.task)) {
        changed = true
        continue
      }
      if (
        entry.task.status === 'working' ||
        entry.task.status === 'input_required'
      ) {
        entry.task = {
          ...entry.task,
          status: 'failed',
          statusMessage:
            'The MCP worker stopped before this durable task completed.',
          lastUpdatedAt: new Date().toISOString(),
          error: {
            code: -32603,
            message: 'Task worker was interrupted',
          },
        }
        delete entry.task.inputRequests
        changed = true
      }
      this.#tasks.set(entry.task.taskId, entry)
    }
    if (changed) this.#save()
  }

  #load(): Mcp2026TaskManifest {
    const path = taskManifestPath(this.#cwd)
    if (!existsSync(path)) return { version: TASK_MANIFEST_VERSION, tasks: [] }
    assertNotSymlink(path)
    try {
      if (statSync(path).size > MAX_TASK_MANIFEST_BYTES) {
        quarantineTaskManifest(path)
        return { version: TASK_MANIFEST_VERSION, tasks: [] }
      }
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
      if (
        !isRecord(parsed) ||
        parsed.version !== TASK_MANIFEST_VERSION ||
        !Array.isArray(parsed.tasks)
      ) {
        quarantineTaskManifest(path)
        return { version: TASK_MANIFEST_VERSION, tasks: [] }
      }
      const validTasks = parsed.tasks.filter(
        (entry): entry is StoredMcp2026Task =>
          isRecord(entry) &&
          typeof entry.owner === 'string' &&
          entry.owner.length > 0 &&
          entry.owner.length <= 256 &&
          !entry.owner.includes('\0') &&
          isTask(entry.task),
      )
      if (validTasks.length !== parsed.tasks.length) {
        quarantineTaskManifest(path)
        return { version: TASK_MANIFEST_VERSION, tasks: [] }
      }
      return {
        version: TASK_MANIFEST_VERSION,
        tasks: validTasks.slice(-MAX_TASKS),
      }
    } catch {
      if (existsSync(path)) quarantineTaskManifest(path)
      return { version: TASK_MANIFEST_VERSION, tasks: [] }
    }
  }

  #save(): void {
    prepareTaskDirectory(this.#cwd)
    const destination = taskManifestPath(this.#cwd)
    assertNotSymlink(destination)
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    const entries = [...this.#tasks.values()].slice(-MAX_TASKS)
    const encoded = entries.map((entry, index) => ({
      entry,
      index,
      json: JSON.stringify(entry),
      active:
        entry.task.status === 'working' ||
        entry.task.status === 'input_required',
    }))
    const candidates = [
      ...encoded.filter(item => item.active).reverse(),
      ...encoded.filter(item => !item.active).reverse(),
    ]
    const selected = new Set<number>()
    let byteBudget =
      MAX_TASK_MANIFEST_BYTES -
      Buffer.byteLength(
        `{"version":${TASK_MANIFEST_VERSION},"tasks":[]}\n`,
      )
    for (const candidate of candidates) {
      const bytes = Buffer.byteLength(candidate.json) + 1
      if (bytes > byteBudget) continue
      selected.add(candidate.index)
      byteBudget -= bytes
    }
    const retained = encoded
      .filter(item => selected.has(item.index))
      .map(item => item.json)
    for (const item of encoded) {
      if (!selected.has(item.index)) {
        this.#tasks.delete(item.entry.task.taskId)
      }
    }
    const serialized = `{"version":${TASK_MANIFEST_VERSION},"tasks":[${retained.join(',')}]}\n`
    try {
      writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' })
      const descriptor = openSync(temporary, constants.O_RDONLY)
      try {
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      renameSync(temporary, destination)
      chmodSync(destination, 0o600)
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }

  async #mutate<T>(operation: () => T): Promise<T> {
    const previous = this.#mutationTail
    let release!: () => void
    this.#mutationTail = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      const result = operation()
      this.#save()
      return result
    } finally {
      release()
    }
  }

  async create(owner: string, ttlMs: number): Promise<Mcp2026Task> {
    return this.#mutate(() => {
      const timestamp = new Date().toISOString()
      const task: Mcp2026Task = {
        taskId: randomUUID(),
        status: 'working',
        statusMessage: 'UR is executing the requested tool.',
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
        ttlMs,
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      }
      this.#tasks.set(task.taskId, { owner, task })
      while (this.#tasks.size > MAX_TASKS) {
        const oldest = this.#tasks.keys().next().value as string | undefined
        if (!oldest) break
        this.#tasks.delete(oldest)
      }
      return structuredClone(task)
    })
  }

  async get(owner: string, taskId: string): Promise<Mcp2026Task | undefined> {
    const entry = this.#tasks.get(taskId)
    if (!entry || entry.owner !== owner || taskExpired(entry.task)) {
      if (entry && taskExpired(entry.task)) {
        await this.#mutate(() => {
          this.#tasks.delete(taskId)
        })
      }
      return undefined
    }
    return structuredClone(entry.task)
  }

  async update(
    owner: string,
    taskId: string,
    operation: (task: Mcp2026Task) => void,
  ): Promise<Mcp2026Task | undefined> {
    return this.#mutate(() => {
      const entry = this.#tasks.get(taskId)
      if (!entry || entry.owner !== owner || taskExpired(entry.task)) {
        if (entry && taskExpired(entry.task)) this.#tasks.delete(taskId)
        return undefined
      }
      operation(entry.task)
      entry.task.lastUpdatedAt = new Date().toISOString()
      return structuredClone(entry.task)
    })
  }
}

function extensionCapability(
  capabilities: Record<string, unknown>,
  extension: string,
): Record<string, unknown> | undefined {
  const extensions = capabilities.extensions
  if (!isRecord(extensions)) return undefined
  const value = extensions[extension]
  return isRecord(value) ? value : undefined
}

function supportsTasks(capabilities: Record<string, unknown>): boolean {
  return extensionCapability(capabilities, MCP_TASKS_EXTENSION) !== undefined
}

function supportsApps(capabilities: Record<string, unknown>): boolean {
  const capability = extensionCapability(capabilities, MCP_APPS_EXTENSION)
  return Boolean(
    capability &&
      Array.isArray(capability.mimeTypes) &&
      capability.mimeTypes.includes(MCP_APP_MIME_TYPE),
  )
}

type McpHeaderBinding = {
  headerName: string
  path: string[]
  type: 'string' | 'integer' | 'boolean'
}

function collectMcpHeaderBindings(
  schema: Record<string, unknown>,
): McpHeaderBinding[] | undefined {
  const bindings: McpHeaderBinding[] = []
  const seenHeaders = new Set<string>()
  const active = new Set<Record<string, unknown>>()
  let valid = true

  const resolveLocalRef = (reference: string): unknown => {
    if (reference === '#') return schema
    if (!reference.startsWith('#/')) return undefined
    let segments: string[]
    try {
      segments = decodeURIComponent(reference.slice(2))
        .split('/')
        .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    } catch {
      valid = false
      return undefined
    }
    let current: unknown = schema
    for (const segment of segments) {
      if (
        !isRecord(current) ||
        segment === '__proto__' ||
        segment === 'prototype' ||
        segment === 'constructor' ||
        !Object.hasOwn(current, segment)
      ) {
        valid = false
        return undefined
      }
      current = current[segment]
    }
    return current
  }

  const visit = (node: unknown, path: string[], depth = 0): void => {
    if (!valid || !isRecord(node)) return
    if (depth > 64) {
      valid = false
      return
    }
    if (active.has(node)) return
    active.add(node)
    if (typeof node.$ref === 'string') {
      const resolved = resolveLocalRef(node.$ref)
      if (node.$ref.startsWith('#') && resolved === undefined) {
        valid = false
      } else if (resolved !== undefined) {
        visit(resolved, path, depth + 1)
      }
    }
    if (node['x-mcp-header'] !== undefined) {
      const headerName = node['x-mcp-header']
      const type = node.type
      const normalized =
        typeof headerName === 'string' ? headerName.toLowerCase() : ''
      if (
        path.length === 0 ||
        typeof headerName !== 'string' ||
        !HTTP_FIELD_NAME.test(headerName) ||
        seenHeaders.has(normalized) ||
        (type !== 'string' && type !== 'integer' && type !== 'boolean')
      ) {
        valid = false
        active.delete(node)
        return
      }
      seenHeaders.add(normalized)
      bindings.push({ headerName, path, type })
    }
    if (isRecord(node.properties)) {
      for (const [property, child] of Object.entries(node.properties)) {
        visit(child, [...path, property], depth + 1)
      }
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
      const children = node[keyword]
      if (Array.isArray(children)) {
        for (const child of children) visit(child, path, depth + 1)
      }
    }
    active.delete(node)
  }

  visit(schema, [])
  return valid ? bindings : undefined
}

function nestedValue(
  value: Record<string, unknown>,
  path: readonly string[],
): { present: boolean; value?: unknown } {
  let current: unknown = value
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return { present: false }
    }
    current = current[segment]
  }
  return { present: true, value: current }
}

function decodeMcpHeaderValue(value: string): string | undefined {
  if (!/^[\x09\x20-\x7e]*$/u.test(value)) return undefined
  const match = BASE64_SENTINEL.exec(value)
  if (!match) return value
  const encoded = match[1] ?? ''
  if (
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      encoded,
    )
  ) {
    return undefined
  }
  try {
    const decoded = Buffer.from(encoded, 'base64')
    if (decoded.toString('base64') !== encoded) return undefined
    return new TextDecoder('utf-8', { fatal: true }).decode(decoded)
  } catch {
    return undefined
  }
}

function primitiveHeaderValue(
  value: unknown,
  type: McpHeaderBinding['type'],
): string | undefined {
  if (type === 'string') return typeof value === 'string' ? value : undefined
  if (type === 'boolean') {
    return typeof value === 'boolean' ? String(value) : undefined
  }
  return typeof value === 'number' &&
    Number.isSafeInteger(value)
    ? String(value)
    : undefined
}

function completeResult(
  value: Record<string, unknown> = {},
): Record<string, unknown> {
  return { resultType: 'complete', ...value }
}

function overviewTool(withApp: boolean): Mcp2026Tool {
  return {
    name: UR_MCP_OVERVIEW_TOOL,
    title: 'UR Agent Overview',
    description:
      'Show UR MCP capabilities and render a secure, self-contained MCP App overview when the host supports MCP Apps.',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        protocolVersion: { type: 'string' },
        features: { type: 'array', items: { type: 'string' } },
      },
      required: ['protocolVersion', 'features'],
      additionalProperties: false,
    },
    ...(withApp
      ? {
          _meta: {
            ui: { resourceUri: UR_MCP_APP_URI },
            // Kept during the extension's compatibility window.
            'ui/resourceUri': UR_MCP_APP_URI,
          },
        }
      : {}),
  }
}

function asyncTool(): Mcp2026Tool {
  return {
    name: UR_MCP_ASYNC_TOOL,
    title: 'Call UR Tool Asynchronously',
    description:
      'Execute a UR MCP tool as a durable MCP Tasks extension task. Requires io.modelcontextprotocol/tasks client capability.',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          minLength: 1,
          description: 'Name of an advertised UR tool to execute.',
        },
        arguments: {
          type: 'object',
          description: 'Arguments passed to the selected tool.',
        },
        ttlMs: {
          type: 'integer',
          minimum: 1_000,
          maximum: 604_800_000,
          description: 'Requested durable retention in milliseconds.',
        },
      },
      required: ['toolName', 'arguments'],
      additionalProperties: false,
    },
  }
}

export function urMcpAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>UR Agent Overview</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 20px; background: var(--color-background-primary, Canvas); color: var(--color-text-primary, CanvasText); }
    main { display: grid; gap: 14px; }
    .hero { display: flex; align-items: center; gap: 12px; }
    .mark { display:grid; place-items:center; width:42px; height:42px; border-radius:12px; background:#6d5dfc; color:white; font-weight:800; }
    h1 { margin: 0; font-size: 1.25rem; } p { margin: 3px 0 0; opacity: .75; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
    .card { border:1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius:12px; padding:12px; background:color-mix(in srgb, Canvas 94%, #6d5dfc 6%); }
    .card strong { display:block; margin-bottom:5px; } code { font-size:.8rem; }
    #status { font-size:.8rem; opacity:.7; }
  </style>
</head>
<body>
  <main>
    <section class="hero"><div class="mark">UR</div><div><h1>UR Agent</h1><p>Stateless MCP 2026 capability view</p></div></section>
    <section class="grid" id="features">
      <div class="card"><strong>Stateless core</strong><code>2026-07-28 RC</code></div>
      <div class="card"><strong>Durable Tasks</strong><code>io.modelcontextprotocol/tasks</code></div>
      <div class="card"><strong>MCP Apps</strong><code>io.modelcontextprotocol/ui</code></div>
      <div class="card"><strong>Secure tools</strong><code>UR permission gates</code></div>
    </section>
    <div id="status">Connecting to host…</div>
  </main>
  <script>
    (() => {
      let nextId = 1;
      const status = document.getElementById('status');
      const initId = nextId++;
      addEventListener('message', event => {
        const message = event.data;
        if (!message || message.jsonrpc !== '2.0') return;
        if (message.id === initId && message.result) {
          status.textContent = 'Connected to ' + (message.result.hostInfo?.name || 'MCP host');
          parent.postMessage({ jsonrpc:'2.0', method:'ui/notifications/initialized', params:{} }, '*');
        }
        if (message.method === 'ui/notifications/tool-result') {
          const data = message.params?.structuredContent;
          if (data?.protocolVersion) status.textContent = 'Protocol ' + data.protocolVersion + ' · ' + (data.features?.length || 0) + ' features';
        }
      });
      parent.postMessage({
        jsonrpc:'2.0', id:initId, method:'ui/initialize',
        params:{ appInfo:{name:'UR Agent Overview',version:'1.0.0'}, appCapabilities:{}, protocolVersion:'2026-01-26' }
      }, '*');
    })();
  </script>
</body>
</html>`
}

export class Mcp2026Runtime {
  readonly #backend: Mcp2026ToolBackend
  readonly #tasks: DurableMcp2026TaskStore
  readonly #workers = new Map<string, AbortController>()
  readonly #version: string

  constructor(options: {
    cwd: string
    backend: Mcp2026ToolBackend
    version: string
  }) {
    this.#backend = options.backend
    this.#tasks = new DurableMcp2026TaskStore(options.cwd)
    this.#version = options.version
  }

  async #tools(withApp: boolean): Promise<Mcp2026Tool[]> {
    const listed = await this.#backend.listTools()
    const tools = listed.tools.filter(
      tool =>
        tool.name !== UR_MCP_OVERVIEW_TOOL && tool.name !== UR_MCP_ASYNC_TOOL,
    ).filter(tool => collectMcpHeaderBindings(tool.inputSchema) !== undefined)
    return [...tools, overviewTool(withApp), asyncTool()]
  }

  async validateToolHeaders(
    name: string,
    args: Record<string, unknown>,
    headers: Headers,
    clientCapabilities: Record<string, unknown>,
  ): Promise<void> {
    const customHeaders: Array<[string, string]> = []
    headers.forEach((value, header) => {
      if (header.toLowerCase().startsWith('mcp-param-')) {
        customHeaders.push([header, value])
      }
    })
    if (
      customHeaders.length > MAX_CUSTOM_HEADER_COUNT ||
      customHeaders.reduce(
        (bytes, [header, value]) =>
          bytes + Buffer.byteLength(header) + Buffer.byteLength(value),
        0,
      ) > MAX_CUSTOM_HEADER_BYTES
    ) {
      throw new Mcp2026Error(
        -32001,
        'Header mismatch: MCP custom header limits were exceeded',
      )
    }
    const tool = (await this.#tools(supportsApps(clientCapabilities))).find(
      candidate => candidate.name === name,
    )
    if (!tool) {
      if (customHeaders.length > 0) {
        throw new Mcp2026Error(
          -32001,
          'Header mismatch: custom headers were supplied for an unknown tool',
        )
      }
      return
    }
    const bindings = collectMcpHeaderBindings(tool.inputSchema) ?? []
    const allowedHeaders = new Set(
      bindings.map(binding => `mcp-param-${binding.headerName}`.toLowerCase()),
    )
    if (
      customHeaders.some(
        ([header]) => !allowedHeaders.has(header.toLowerCase()),
      )
    ) {
      throw new Mcp2026Error(
        -32001,
        'Header mismatch: an unadvertised Mcp-Param header was supplied',
      )
    }
    for (const binding of bindings) {
      const header = `mcp-param-${binding.headerName}`
      const supplied = headers.has(header)
      const argument = nestedValue(args, binding.path)
      if (!argument.present || argument.value === null) {
        if (supplied) {
          throw new Mcp2026Error(
            -32001,
            `Header mismatch: ${header} must be omitted when its argument is absent or null`,
          )
        }
        continue
      }
      if (!supplied) {
        throw new Mcp2026Error(
          -32001,
          `Header mismatch: ${header} is required`,
        )
      }
      const expected = primitiveHeaderValue(argument.value, binding.type)
      const decoded = decodeMcpHeaderValue(headers.get(header) ?? '')
      if (expected === undefined || decoded === undefined || decoded !== expected) {
        throw new Mcp2026Error(
          -32001,
          `Header mismatch: ${header} does not match its tool argument`,
        )
      }
    }
  }

  #requireTasks(context: Mcp2026RequestContext): void {
    if (supportsTasks(context.clientCapabilities)) return
    throw new Mcp2026Error(-32003, 'Missing required client capability', {
      requiredCapabilities: {
        extensions: { [MCP_TASKS_EXTENSION]: {} },
      },
    })
  }

  #overviewResult(): Record<string, unknown> {
    const structuredContent = {
      protocolVersion: MCP_2026_PROTOCOL_VERSION,
      features: [
        'stateless core',
        'durable tasks',
        'MCP Apps',
        'cacheable discovery',
        'permission-gated UR tools',
      ],
    }
    return completeResult({
      content: [
        {
          type: 'text',
          text: `UR MCP ${MCP_2026_PROTOCOL_VERSION}: ${structuredContent.features.join(', ')}.`,
        },
      ],
      structuredContent,
    })
  }

  async #createTask(
    params: Record<string, unknown>,
    context: Mcp2026RequestContext,
  ): Promise<Record<string, unknown>> {
    this.#requireTasks(context)
    const args = cloneBoundedRecord(
      params.arguments ?? {},
      'arguments',
      2_000_000,
    )
    const toolName = safeString(args.toolName, 'arguments.toolName', 256)
    if (toolName === UR_MCP_ASYNC_TOOL) {
      throw new Mcp2026Error(-32602, 'Recursive asynchronous tool calls are not allowed')
    }
    const nestedArguments = cloneBoundedRecord(
      args.arguments,
      'arguments.arguments',
      2_000_000,
    )
    const tools = await this.#tools(supportsApps(context.clientCapabilities))
    if (!tools.some(tool => tool.name === toolName)) {
      throw new Mcp2026Error(-32602, `Tool '${toolName}' was not found`)
    }
    const requestedTtl = args.ttlMs
    const ttlMs =
      typeof requestedTtl === 'number' &&
      Number.isSafeInteger(requestedTtl) &&
      requestedTtl >= 1_000 &&
      requestedTtl <= 7 * 24 * 60 * 60 * 1_000
        ? requestedTtl
        : DEFAULT_TASK_TTL_MS
    const task = await this.#tasks.create(context.owner, ttlMs)
    const controller = new AbortController()
    this.#workers.set(task.taskId, controller)

    void this.#backend
      .callTool(toolName, nestedArguments, controller.signal)
      .then(async result => {
        await this.#tasks.update(context.owner, task.taskId, current => {
          if (current.status === 'cancelled') return
          current.status = 'completed'
          current.statusMessage = result.isError
            ? `Tool '${toolName}' completed with a tool-level error.`
            : `Tool '${toolName}' completed.`
          current.result = cloneBoundedRecord(
            result,
            'task result',
            MAX_TASK_RESULT_BYTES,
          )
        })
      })
      .catch(async error => {
        await this.#tasks.update(context.owner, task.taskId, current => {
          if (current.status === 'cancelled') return
          current.status = 'failed'
          current.statusMessage = `Tool '${toolName}' failed.`
          current.error = {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          }
        })
      })
      .finally(() => {
        this.#workers.delete(task.taskId)
      })
      .catch(() => {
        // The in-memory task was already updated. A persistence failure must
        // not become an unhandled rejection in the stateless HTTP server.
      })

    return { resultType: 'task', ...task }
  }

  async #getTask(
    params: Record<string, unknown>,
    context: Mcp2026RequestContext,
  ): Promise<Record<string, unknown>> {
    this.#requireTasks(context)
    const taskId = safeString(params.taskId, 'taskId', 256)
    const task = await this.#tasks.get(context.owner, taskId)
    if (!task) throw new Mcp2026Error(-32602, 'Task not found')
    return { resultType: 'complete', ...task }
  }

  async #updateTask(
    params: Record<string, unknown>,
    context: Mcp2026RequestContext,
  ): Promise<Record<string, unknown>> {
    this.#requireTasks(context)
    const taskId = safeString(params.taskId, 'taskId', 256)
    const inputResponses = cloneBoundedRecord(
      params.inputResponses,
      'inputResponses',
      1_000_000,
    )
    const task = await this.#tasks.get(context.owner, taskId)
    if (!task) throw new Mcp2026Error(-32602, 'Task not found')
    if (task.status !== 'input_required' || !task.inputRequests) {
      throw new Mcp2026Error(-32602, 'Task is not waiting for client input')
    }
    const outstanding = Object.keys(task.inputRequests)
    const supplied = Object.keys(inputResponses)
    if (
      supplied.length === 0 ||
      supplied.some(key => !outstanding.includes(key))
    ) {
      throw new Mcp2026Error(
        -32602,
        'inputResponses contains no outstanding task request keys',
      )
    }
    await this.#tasks.update(context.owner, taskId, current => {
      for (const key of supplied) delete current.inputRequests?.[key]
      if (Object.keys(current.inputRequests ?? {}).length === 0) {
        delete current.inputRequests
        current.status = 'working'
        current.statusMessage = 'Client input was accepted.'
      }
    })
    return completeResult()
  }

  async #cancelTask(
    params: Record<string, unknown>,
    context: Mcp2026RequestContext,
  ): Promise<Record<string, unknown>> {
    this.#requireTasks(context)
    const taskId = safeString(params.taskId, 'taskId', 256)
    const task = await this.#tasks.get(context.owner, taskId)
    if (!task) throw new Mcp2026Error(-32602, 'Task not found')
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      throw new Mcp2026Error(-32602, 'Task is already terminal')
    }
    await this.#tasks.update(context.owner, taskId, current => {
      current.status = 'cancelled'
      current.statusMessage = 'Cancellation was requested by the client.'
      delete current.inputRequests
    })
    this.#workers.get(taskId)?.abort(new Error('MCP task cancelled'))
    return completeResult()
  }

  async handle(
    payload: unknown,
    context: Mcp2026RequestContext,
  ): Promise<Mcp2026JsonRpcResponse> {
    let id: Mcp2026JsonRpcId = null
    try {
      if (!isRecord(payload)) {
        throw new Mcp2026Error(-32600, 'Invalid Request')
      }
      if (
        payload.id !== undefined &&
        payload.id !== null &&
        typeof payload.id !== 'string' &&
        !(typeof payload.id === 'number' && Number.isSafeInteger(payload.id))
      ) {
        throw new Mcp2026Error(-32600, 'Invalid JSON-RPC request id')
      }
      id =
        typeof payload.id === 'string' || typeof payload.id === 'number'
          ? payload.id
          : null
      if (payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
        throw new Mcp2026Error(-32600, 'Invalid Request')
      }
      const params =
        payload.params === undefined
          ? {}
          : cloneBoundedRecord(payload.params, 'params', 2_000_000)
      let result: Record<string, unknown>

      switch (payload.method) {
        case 'server/discover':
          result = completeResult({
            supportedVersions: [MCP_2026_PROTOCOL_VERSION],
            capabilities: {
              tools: {},
              resources: {},
              extensions: {
                [MCP_TASKS_EXTENSION]: {},
                [MCP_APPS_EXTENSION]: {
                  mimeTypes: [MCP_APP_MIME_TYPE],
                },
              },
            },
            serverInfo: { name: 'ur-nexus', version: this.#version },
            instructions:
              'UR exposes permission-gated local coding tools. Use ur.async.call only when the MCP Tasks extension is available.',
          })
          break
        case 'tools/list':
          result = completeResult({
            tools: await this.#tools(supportsApps(context.clientCapabilities)),
            ttlMs: 300_000,
            cacheScope: 'private',
          })
          break
        case 'tools/call': {
          const name = safeString(params.name, 'name', 256)
          if (name === UR_MCP_OVERVIEW_TOOL) {
            result = this.#overviewResult()
          } else if (name === UR_MCP_ASYNC_TOOL) {
            result = await this.#createTask(params, context)
          } else {
            const args = cloneBoundedRecord(
              params.arguments ?? {},
              'arguments',
              2_000_000,
            )
            const tools = await this.#tools(
              supportsApps(context.clientCapabilities),
            )
            if (!tools.some(tool => tool.name === name)) {
              throw new Mcp2026Error(-32602, `Tool '${name}' was not found`)
            }
            result = completeResult(
              cloneBoundedRecord(
                await this.#backend.callTool(name, args, context.signal),
                'tool result',
                MAX_TASK_RESULT_BYTES,
              ),
            )
          }
          break
        }
        case 'resources/list':
          result = completeResult({
            resources: supportsApps(context.clientCapabilities)
              ? [
                  {
                    uri: UR_MCP_APP_URI,
                    name: 'UR Agent Overview',
                    title: 'UR Agent Overview',
                    description:
                      'Secure self-contained overview for UR MCP capabilities.',
                    mimeType: MCP_APP_MIME_TYPE,
                  },
                ]
              : [],
            ttlMs: 300_000,
            cacheScope: 'public',
          })
          break
        case 'resources/read': {
          const uri = safeString(params.uri, 'uri', 2_048)
          if (uri !== UR_MCP_APP_URI) {
            throw new Mcp2026Error(-32002, 'Resource not found')
          }
          if (!supportsApps(context.clientCapabilities)) {
            throw new Mcp2026Error(
              -32003,
              'Missing required client capability',
              {
                requiredCapabilities: {
                  extensions: {
                    [MCP_APPS_EXTENSION]: {
                      mimeTypes: [MCP_APP_MIME_TYPE],
                    },
                  },
                },
              },
            )
          }
          result = completeResult({
            contents: [
              {
                uri: UR_MCP_APP_URI,
                mimeType: MCP_APP_MIME_TYPE,
                text: urMcpAppHtml(),
                _meta: {
                  ui: {
                    csp: {
                      connectDomains: [],
                      resourceDomains: [],
                      frameDomains: [],
                    },
                    permissions: {},
                    prefersBorder: true,
                  },
                },
              },
            ],
            ttlMs: 300_000,
            cacheScope: 'public',
          })
          break
        }
        case 'resources/templates/list':
          result = completeResult({
            resourceTemplates: [],
            ttlMs: 300_000,
            cacheScope: 'public',
          })
          break
        case 'prompts/list':
          result = completeResult({
            prompts: [],
            ttlMs: 300_000,
            cacheScope: 'public',
          })
          break
        case 'tasks/get':
          result = await this.#getTask(params, context)
          break
        case 'tasks/update':
          result = await this.#updateTask(params, context)
          break
        case 'tasks/cancel':
          result = await this.#cancelTask(params, context)
          break
        case 'initialize':
        case 'notifications/initialized':
        case 'ping':
          throw new Mcp2026Error(
            -32601,
            `Method '${payload.method}' was removed in MCP ${MCP_2026_PROTOCOL_VERSION}`,
          )
        default:
          throw new Mcp2026Error(-32601, 'Method not found')
      }
      return { jsonrpc: '2.0', id, result }
    } catch (error) {
      const mapped =
        error instanceof Mcp2026Error
          ? error
          : new Mcp2026Error(
              -32603,
              error instanceof Error ? error.message : 'Internal error',
            )
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: mapped.code,
          message: mapped.message,
          ...(mapped.data !== undefined ? { data: mapped.data } : {}),
        },
      }
    }
  }
}

export function mcp2026HttpStatus(response: Mcp2026JsonRpcResponse): number {
  if (!response.error) return 200
  if (response.error.code === -32601 || response.error.code === -32002) {
    return 404
  }
  if (response.error.code === -32603) return 500
  return 400
}
