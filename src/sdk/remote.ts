import { EventQueue, SDK_PROTOCOL_VERSION, type JsonObject, type PermissionDecision, type UrEvent } from './index.js'

export type RemoteOptions = { endpoint: string; token: string; timeoutMs?: number; fetch?: typeof globalThis.fetch }
export type RemoteResult = { ok: boolean; canceled: boolean; sessionId: string; lastSequence: number; stopReason?: string; error?: string }
export interface RemoteRun extends AsyncIterable<UrEvent> {
  readonly sessionId: string
  readonly result: Promise<RemoteResult>
  readonly lastSequence: number
  approve(requestId: string, decision: PermissionDecision): Promise<void>
  cancel(): Promise<void>
  /** Detach this observer without canceling remote work; reconnect using its lastSequence. */
  disconnect(): void
}

/** Authenticated client of the existing `ur acp serve` HTTP JSON-RPC endpoint. */
export class UrRemoteClient {
  private nextId = 0
  private readonly endpoint: URL
  constructor(private readonly options: RemoteOptions) {
    this.endpoint = new URL(options.endpoint)
    if (!['http:', 'https:'].includes(this.endpoint.protocol) || this.endpoint.username || this.endpoint.password) throw new Error('ACP endpoint must be an HTTP(S) URL without embedded credentials')
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error('timeoutMs must be a positive integer')
    if (!options.token.trim()) throw new Error('ACP token is required')
    if (this.endpoint.pathname === '/') this.endpoint.pathname = '/acp'
  }
  async request<T = unknown>(method: string, params: JsonObject = {}, signal?: AbortSignal): Promise<T> {
    const id = ++this.nextId
    const response = await (this.options.fetch ?? globalThis.fetch)(this.endpoint, {
      method: 'POST', headers: { authorization: `Bearer ${this.options.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs ?? 30_000), ...(signal ? [signal] : [])]),
    })
    if (!response.ok) throw new Error(`ACP ${method} returned HTTP ${response.status}`)
    let bytes = 0
    const chunks: Uint8Array[] = []
    if (!response.body) throw new Error('ACP response has no body')
    const reader = response.body.getReader()
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 16 * 1024 * 1024) { await reader.cancel(); throw new Error('ACP response exceeded 16 MiB') }; chunks.push(value) }
    } finally { reader.releaseLock() }
    const text = Buffer.concat(chunks).toString('utf8')
    const envelope = JSON.parse(text)
    if (envelope.jsonrpc !== '2.0' || envelope.id !== id) throw new Error('ACP response identity does not match request')
    if (envelope.error) throw new Error(`ACP ${method}: ${envelope.error.message ?? 'request failed'} (${envelope.error.code ?? 'unknown'})`)
    if (!Object.hasOwn(envelope, 'result')) throw new Error('ACP response has no result')
    return envelope.result as T
  }
  initialize() { return this.request<JsonObject>('initialize') }
  newSession(cwd?: string) { return this.request<{ sessionId: string; workspaceRoot: string }>('session/new', cwd ? { cwd } : {}) }
  close(sessionId: string) { return this.request<{ closed: boolean; canceled: boolean }>('session/close', { sessionId }) }
  async stream(prompt: string, options: { sessionId?: string; cwd?: string; after?: number; requestId?: string; signal?: AbortSignal } = {}): Promise<RemoteRun> {
    if (options.after !== undefined && (!Number.isSafeInteger(options.after) || options.after < 0)) throw new Error('after must be a nonnegative integer event cursor')
    if (!prompt.trim()) throw new Error('prompt must be nonempty text')
    options.signal?.throwIfAborted()
    const session = options.sessionId ? await this.request<{ sessionId: string; lastSequence: number }>('session/resume', { sessionId: options.sessionId }, options.signal) : await this.newSession(options.cwd)
    const after = options.after ?? ('lastSequence' in session ? session.lastSequence : 0)
    await this.request('session/prompt', { sessionId: session.sessionId, prompt, stream: true, ...(options.requestId ? { requestId: options.requestId } : {}) }, options.signal)
    return this.observe(session.sessionId, after, options.signal)
  }
  /** Reconnect to existing work without resubmitting a prompt. Persist lastSequence with sessionId. */
  async resume(sessionId: string, after = 0, signal?: AbortSignal): Promise<RemoteRun> {
    await this.request('session/resume', { sessionId }, signal)
    return this.observe(sessionId, after, signal)
  }
  private observe(sessionId: string, after: number, externalSignal?: AbortSignal): RemoteRun {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('after must be a nonnegative integer event cursor')
    let cursor = after, settled = false, canceled = false
    const controller = new AbortController()
    const pending = new Set<string>()
    let resolve!: (result: RemoteResult) => void
    const result = new Promise<RemoteResult>(done => { resolve = done })
    const finish = (error?: string, stopReason?: string) => {
      if (settled) return
      settled = true; pending.clear(); queue.end(); externalSignal?.removeEventListener('abort', disconnected)
      resolve({ ok: !error && !canceled && stopReason !== 'cancelled' && stopReason !== 'canceled', canceled, sessionId, lastSequence: cursor, ...(error ? { error } : {}), ...(stopReason ? { stopReason } : {}) })
    }
    const disconnected = () => { controller.abort(); finish('Remote observer disconnected; remote work may still be running') }
    const queue = new EventQueue<UrEvent>(4096, disconnected)
    externalSignal?.addEventListener('abort', disconnected, { once: true })
    if (externalSignal?.aborted) disconnected()
    const approve = async (requestId: string, decision: PermissionDecision) => {
      if (settled || !pending.has(requestId)) throw new Error('Permission request is no longer pending')
      if (decision.behavior === 'allow' && decision.updatedInput) throw new Error('ACP approvals support allow_once/deny without rewriting tool input')
      const accepted = await this.request<{ accepted: boolean }>('session/approve', { sessionId, requestId, decision })
      if (!accepted.accepted) throw new Error('ACP permission decision was not accepted')
      pending.delete(requestId)
    }
    void (async () => {
      try {
        while (!settled) {
          const page = await this.request<{ protocolVersion: number; events: Array<{ protocolVersion: number; sequence: number; sessionId: string; event: JsonObject }>; nextCursor: number; done: boolean; result?: { stopReason: string }; error?: string }>('session/events', { sessionId, after: cursor, waitMs: 25000 }, controller.signal)
          if (page.protocolVersion !== SDK_PROTOCOL_VERSION || !Array.isArray(page.events)) throw new Error('Unsupported ACP event protocol revision')
          for (const item of page.events) {
            if (item.protocolVersion !== SDK_PROTOCOL_VERSION || item.sessionId !== sessionId || item.sequence !== cursor + 1 || !item.event || typeof item.event.type !== 'string') throw new Error('ACP event stream has a missing, repeated, or mismatched event')
            cursor = item.sequence
            if (item.event.type === 'permission' && typeof item.event.requestId === 'string') pending.add(item.event.requestId)
            queue.push({ ...item, protocolVersion: SDK_PROTOCOL_VERSION, transport: 'acp' })
          }
          if (page.nextCursor !== cursor) throw new Error('ACP cursor skipped unobserved events')
          if (page.error) throw new Error(page.error)
          if (page.done) { if (!page.result?.stopReason) throw new Error('ACP run finished without a result'); finish(undefined, page.result.stopReason); return }
        }
      } catch (error) { if (!settled) finish(error instanceof Error ? error.message : String(error)) }
    })()
    return {
      sessionId, result, get lastSequence() { return cursor }, approve, disconnect: disconnected,
      cancel: async () => { if (settled) return; const response = await this.request<{ canceled: boolean }>('session/cancel', { sessionId }); if (!response.canceled) throw new Error('ACP did not cancel the running session'); canceled = true; controller.abort(); finish('Remote run canceled') },
      [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](),
    }
  }
}
