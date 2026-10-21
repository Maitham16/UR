/** Public dependency-free Node SDK. Wire revision 1; native UR owns execution. */
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SDK_PROTOCOL_VERSION = 1 as const
export type JsonObject = Record<string, unknown>
export type PermissionDecision = { behavior: 'allow'; updatedInput?: JsonObject } | { behavior: 'deny'; message?: string }
export type PermissionRequest = { requestId: string; toolName: string; input: JsonObject; raw: JsonObject }
export type UrEvent = { protocolVersion: 1; sequence: number; sessionId?: string; transport: 'local' | 'acp'; event: JsonObject }
export type QueryOptions = {
  cwd?: string
  model?: string
  maxTurns?: number
  skipPermissions?: boolean
  timeoutMs?: number
  bin?: { file: string; args?: string[] }
  env?: Record<string, string>
  resumeSessionId?: string
  signal?: AbortSignal
  onPermission?: (request: PermissionRequest) => PermissionDecision | Promise<PermissionDecision>
  /** Explicit buffering bounds; excess output terminates with an error, never silent loss. */
  maxOutputBytes?: number
  maxQueuedEvents?: number
}
export type QueryResult = {
  ok: boolean; text: string; raw: string; exitCode: number; stderr: string
  sessionId?: string; canceled: boolean; error?: string; result?: JsonObject
}

/** Single-consumer stream with explicit bounded buffering and cancellation on early return. */
export class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiter?: (value: IteratorResult<T>) => void
  private ended = false
  private claimed = false
  constructor(private limit: number, private stop: () => void) {}
  push(value: T): void {
    if (this.ended) return
    if (this.waiter) { const resolve = this.waiter; this.waiter = undefined; resolve({ value, done: false }); return }
    if (this.items.length >= this.limit) throw new Error(`Event queue exceeded ${this.limit}; consume the stream or increase maxQueuedEvents`)
    this.items.push(value)
  }
  end(): void { this.ended = true; this.waiter?.({ value: undefined, done: true }); this.waiter = undefined }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.claimed) throw new Error('A run event stream supports one consumer')
    this.claimed = true
    return {
      next: () => this.items.length ? Promise.resolve({ value: this.items.shift()!, done: false }) : this.ended ? Promise.resolve({ value: undefined, done: true }) : new Promise(resolve => { this.waiter = resolve }),
      return: async () => { this.stop(); this.items = []; this.end(); return { value: undefined, done: true } },
    }
  }
}

function positive(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

export function parseResultText(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) return ''
  const extract = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) { for (const item of [...value].reverse()) { const found = extract(item); if (found !== undefined) return found } }
    if (value && typeof value === 'object') { const item = value as JsonObject; for (const key of ['result', 'text', 'content']) if (typeof item[key] === 'string') return item[key] as string }
  }
  try { return extract(JSON.parse(trimmed)) ?? trimmed } catch {
    for (const line of trimmed.split('\n').reverse()) { try { const item = JSON.parse(line); if (item.type === 'result') return extract(item) ?? '' } catch {} }
    return trimmed
  }
}

export interface UrRun extends AsyncIterable<UrEvent> {
  readonly result: Promise<QueryResult>
  readonly sessionId: string | undefined
  cancel(): void
  approve(requestId: string, decision: PermissionDecision): Promise<void>
}

/** Starts installed UR without a shell; supports approvals, cancellation and persisted CLI resume. */
export function stream(prompt: string, options: QueryOptions = {}): UrRun {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt must be nonempty text')
  const maximum = positive(options.maxOutputBytes, 64 * 1024 * 1024, 'maxOutputBytes')
  const timeoutMs = positive(options.timeoutMs, 30 * 60 * 1000, 'timeoutMs')
  const queueLimit = positive(options.maxQueuedEvents, 4096, 'maxQueuedEvents')
  const env = { ...process.env, ...options.env }
  const bundledLauncher = fileURLToPath(new URL('../bin/ur.js', import.meta.url))
  const executable = options.bin ?? (env.UR_EXECUTABLE ? { file: env.UR_EXECUTABLE } : existsSync(bundledLauncher) ? { file: process.execPath, args: [bundledLauncher] } : { file: 'ur' })
  const args = [...(executable.args ?? []), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio']
  if (options.model) args.push('--model', options.model)
  if (options.maxTurns !== undefined) args.push('--max-turns', String(positive(options.maxTurns, 1, 'maxTurns')))
  if (options.resumeSessionId) args.push('--resume', options.resumeSessionId)
  if (options.skipPermissions) args.push('--dangerously-skip-permissions')
  let sessionId = options.resumeSessionId
  let child: ReturnType<typeof spawn> | undefined
  let settled = false, canceled = false, failure: string | undefined, final: JsonObject | undefined
  let raw = '', stderr = '', partial = '', bytes = 0, sequence = 0
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const decoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  const pending = new Map<string, JsonObject>()
  const terminate = () => {
    if (settled) return
    child?.kill('SIGTERM')
    if (!killTimer) { killTimer = setTimeout(() => child?.kill('SIGKILL'), 2000); killTimer.unref() }
  }
  const cancel = () => { if (!settled) { canceled = true; terminate() } }
  const fail = (error: unknown) => { failure ??= error instanceof Error ? error.message : String(error); terminate() }
  const queue = new EventQueue<UrEvent>(queueLimit, cancel)
  let resolveResult!: (value: QueryResult) => void
  const result = new Promise<QueryResult>(resolve => { resolveResult = resolve })
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (settled) return
    settled = true
    clearTimeout(timeout); clearTimeout(killTimer); options.signal?.removeEventListener('abort', cancel); pending.clear()
    const reportedFailure = final?.is_error === true || (typeof final?.subtype === 'string' && final.subtype.startsWith('error'))
    const error = failure ?? (canceled ? 'Run canceled' : signal ? `UR terminated by ${signal}` : code !== 0 ? `UR exited with code ${code}` : !final ? 'UR exited without a result frame' : reportedFailure ? `UR reported ${String(final?.subtype ?? 'an error')}` : undefined)
    queue.end()
    resolveResult({ ok: !error, text: final ? parseResultText(JSON.stringify(final)) : '', raw, exitCode: code ?? 1, stderr, sessionId, canceled, ...(error ? { error } : {}), ...(final ? { result: final } : {}) })
  }
  const approve = async (requestId: string, decision: PermissionDecision) => {
    if (!pending.has(requestId) || settled || canceled) throw new Error('Permission request is no longer pending')
    if (decision?.behavior !== 'allow' && decision?.behavior !== 'deny') throw new Error('Permission decision must be allow or deny')
    const response = decision.behavior === 'allow'
      ? { ...decision, updatedInput: decision.updatedInput === undefined ? pending.get(requestId)! : decision.updatedInput }
      : { ...decision, message: decision.message === undefined ? 'Permission denied by SDK caller' : decision.message }
    if (response.behavior === 'allow' && (!response.updatedInput || typeof response.updatedInput !== 'object' || Array.isArray(response.updatedInput))) throw new Error('updatedInput must be an object')
    if (response.behavior === 'deny' && typeof response.message !== 'string') throw new Error('Permission denial message must be text')
    pending.delete(requestId)
    const wire = JSON.stringify({ type: 'control_response', response: { request_id: requestId, subtype: 'success', response } }) + '\n'
    await new Promise<void>((resolve, reject) => { if (!child?.stdin?.writable) { reject(new Error('UR input is closed')); return } child.stdin.write(wire, error => error ? reject(error) : resolve()) })
  }
  const accept = (line: string) => {
    if (!line.trim()) return
    const frame: unknown = JSON.parse(line)
    if (!frame || typeof frame !== 'object' || typeof (frame as JsonObject).type !== 'string') throw new Error('Malformed stream-json event')
    const event = frame as JsonObject
    if (typeof event.session_id === 'string') sessionId = event.session_id
    if (event.type === 'result') { if (final) throw new Error('UR emitted multiple result frames'); final = event; child?.stdin?.end() }
    if (event.type === 'control_cancel_request' && typeof event.request_id === 'string') pending.delete(event.request_id)
    if (event.type === 'control_request' && typeof event.request_id === 'string') {
      const request = event.request as JsonObject | undefined
      if (request?.subtype === 'can_use_tool') {
        const input = request.input ?? {}
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Permission input must be an object')
        // Keep the exact original independent of caller mutation; only explicit updatedInput rewrites it.
        pending.set(event.request_id, structuredClone(input) as JsonObject)
        if (options.onPermission) {
          const id = event.request_id
          const permission: PermissionRequest = { requestId: id, toolName: String(request.tool_name ?? ''), input: (request.input as JsonObject) ?? {}, raw: event }
          void Promise.resolve().then(() => options.onPermission!(permission)).catch(error => ({ behavior: 'deny', message: `Permission callback failed: ${String(error)}` } as PermissionDecision)).then(async decision => { if (pending.has(id) && !settled && !canceled) await approve(id, decision) }).catch(fail)
        }
      }
    }
    queue.push({ protocolVersion: SDK_PROTOCOL_VERSION, sequence: ++sequence, sessionId, transport: 'local', event })
  }
  const consume = (text: string, flush = false) => {
    partial += text
    let index: number
    while ((index = partial.indexOf('\n')) >= 0) { const line = partial.slice(0, index); partial = partial.slice(index + 1); accept(line) }
    if (Buffer.byteLength(partial) > 16 * 1024 * 1024) throw new Error('Stream JSON line exceeds 16 MiB')
    if (flush && partial.trim()) { accept(partial); partial = '' }
  }
  if (options.signal?.aborted) { canceled = true; finish(null, null) }
  else {
    try {
      child = spawn(executable.file, args, { cwd: options.cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      child.stdin?.on('error', error => { if (!settled && !canceled) fail(error) })
      child.stdout?.on('data', (chunk: Buffer) => {
        if (failure) return
        bytes += chunk.length
        if (bytes > maximum) { fail(new Error(`UR output exceeded ${maximum} bytes`)); return }
        const text = decoder.write(chunk); raw += text
        try { consume(text) } catch (error) { fail(error) }
      })
      child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + stderrDecoder.write(chunk)).slice(-65536) })
      child.on('error', error => { failure = error.message; finish(null, null) })
      // close, not exit: all final stdout/stderr bytes must be drained first.
      child.on('close', (code, signal) => {
        try { const remaining = decoder.end(); raw += remaining; if (!failure) consume(remaining, true); stderr = (stderr + stderrDecoder.end()).slice(-65536) } catch (error) { failure = String(error) }
        finish(code, signal)
      })
      child.stdin?.write(JSON.stringify({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'initialize' } }) + '\n' + JSON.stringify({ type: 'user', session_id: '', message: { role: 'user', content: prompt }, parent_tool_use_id: null }) + '\n')
      timeout = setTimeout(() => { failure = `UR exceeded timeout ${timeoutMs}ms`; terminate() }, timeoutMs); timeout.unref()
      options.signal?.addEventListener('abort', cancel, { once: true })
      if (options.signal?.aborted) cancel()
    } catch (error) { failure = String(error); finish(null, null) }
  }
  return { result, get sessionId() { return sessionId }, cancel, approve, [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator]() }
}

/** Convenience query consumes events; an unhandled permission request is explicitly denied. */
export async function query(prompt: string, options: QueryOptions = {}): Promise<QueryResult> {
  const run = stream(prompt, { ...options, onPermission: options.onPermission ?? (() => ({ behavior: 'deny', message: 'No SDK permission callback was provided' })) })
  for await (const _event of run) { /* drain bounded event queue */ }
  return run.result
}
export async function queryJSON<T = unknown>(prompt: string, options: QueryOptions = {}): Promise<T | null> {
  const result = await query(prompt, options)
  if (!result.ok) return null
  try { return JSON.parse(result.text) as T } catch { return null }
}
export class UrClient {
  constructor(private readonly defaults: QueryOptions = {}) {}
  query(prompt: string, options: QueryOptions = {}) { return query(prompt, { ...this.defaults, ...options }) }
  queryJSON<T = unknown>(prompt: string, options: QueryOptions = {}) { return queryJSON<T>(prompt, { ...this.defaults, ...options }) }
  stream(prompt: string, options: QueryOptions = {}) { return stream(prompt, { ...this.defaults, ...options }) }
  resume(sessionId: string, prompt: string, options: QueryOptions = {}) { return this.stream(prompt, { ...options, resumeSessionId: sessionId }) }
}
export { UrRemoteClient, type RemoteOptions, type RemoteRun, type RemoteResult } from './remote.js'
