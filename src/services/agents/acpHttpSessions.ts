import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import { createAcpRuntime, defaultAcpPromptRunner, type AcpPromptRunner } from './acpStdio.js'
import { atomicWriteJson, isProcessAlive, makeProcessOwner, ownerMayBeAlive, withStateLock, type ProcessOwner } from './durableState.js'

export type RemoteSessionEvent = { protocolVersion: 1; sequence: number; sessionId: string; event:
  | { type: 'session/update'; update: acp.SessionUpdate }
  | { type: 'permission'; requestId: string; request: acp.RequestPermissionRequest }
  | { type: 'result'; stopReason: acp.StopReason }
  | { type: 'error'; message: string }
}
type RemoteRecord = {
  version: 1; id: string; runtimeId: string; cwd: string; createdAt: string; updatedAt: string
  status: 'idle' | 'running' | 'completed' | 'interrupted' | 'closed'
  runId?: string; owner?: ProcessOwner; childPid?: number; launchIntent?: boolean
  requests: Record<string, { promptSha256: string; runId: string }>
  result?: { stopReason: acp.StopReason }; error?: string
}
type Device = { id: string; tokenSha256: string; sessionIds: string[]; expiresAt: string; revokedAt?: string }
type PendingPermission = { sessionId: string; resolve: (decision: acp.RequestPermissionResponse) => void; timer: ReturnType<typeof setTimeout> }
export type AcpHttpSessionOptions = { cwd: string; token?: string; dryRun?: boolean; runPrompt?: AcpPromptRunner; stateDir?: string }
export type AcpPromptControl = { env?: NodeJS.ProcessEnv; onComplete?: (failed: boolean) => void }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const sessionPattern = /^sess_[0-9a-f-]{36}$/u

export class AcpHttpSessionManager {
  private readonly root: string
  private readonly store: string
  private readonly runtime: ReturnType<typeof createAcpRuntime>
  private readonly permissions = new Map<string, PendingPermission>()
  private readonly decisions = new Map<string, 'allow' | 'deny'>()
  private readonly active = new Map<string, Promise<unknown>>()
  private readonly cache = new Map<string, { bytes: number; ino: number; mtimeMs: number; ctimeMs: number; events: RemoteSessionEvent[] }>()
  private readonly waiters = new Map<string, Set<() => void>>()
  private readonly controls = new Map<string, AcpPromptControl>()
  constructor(private readonly options: AcpHttpSessionOptions) {
    this.root = realpathSync(options.cwd)
    this.store = resolve(options.stateDir ?? process.env.UR_REMOTE_STATE_DIR ?? join(this.root, '.ur', 'remote', 'http'))
    mkdirSync(this.store, { recursive: true, mode: 0o700 })
    const runPrompt = options.runPrompt ?? (options.dryRun ? async (_prompt, ctx) => { await ctx.onChunk('[dry-run] no model execution'); return { stopReason: 'end_turn' as const, resumeSessionId: ctx.sessionId } } : defaultAcpPromptRunner)
    this.runtime = createAcpRuntime({ cwd: this.root, sessionStoreRoot: this.store, persistSessions: true,
      runPrompt: async (prompt, context) => {
        const id = `sess_${context.sessionId}`
        this.change(id, record => { record.launchIntent = true })
        return await runPrompt(prompt, { ...context, env: this.controls.get(context.sessionId)?.env,
          onSpawn: pid => { this.change(id, record => { record.childPid = pid }) } })
      },
    })
  }
  get stateDirectory(): string { return this.store }
  private file(id: string): string {
    if (!sessionPattern.test(id)) throw new Error('Invalid remote session identifier.')
    return join(this.store, `${id}.json`)
  }
  private eventsFile(id: string): string { return `${this.file(id)}l` }
  private read(id: string): RemoteRecord {
    const path = this.file(id)
    if (!existsSync(path)) throw new Error(`unknown session: ${id}`)
    if (statSync(path).size > 1024 * 1024) throw new Error('Remote session metadata exceeds its limit.')
    const record = JSON.parse(readFileSync(path, 'utf8')) as RemoteRecord
    if (record.version !== 1 || record.id !== id || `sess_${record.runtimeId}` !== id || !record.requests || typeof record.cwd !== 'string') throw new Error('Invalid persisted remote session metadata.')
    return record
  }
  private change<T>(id: string, operation: (record: RemoteRecord) => T): T {
    return withStateLock(`${this.file(id)}.lock`, () => {
      const record = this.read(id), result = operation(record)
      record.updatedAt = new Date().toISOString()
      atomicWriteJson(this.file(id), record)
      return result
    })
  }
  private journal(id: string): RemoteSessionEvent[] {
    const path = this.eventsFile(id)
    if (!existsSync(path)) return []
    const info = statSync(path), bytes = info.size, cached = this.cache.get(id)
    if (cached?.bytes === bytes && cached.ino === info.ino && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs) return cached.events
    if (bytes > 32 * 1024 * 1024) throw new Error('Remote event journal exceeds 32 MiB; archive this session before continuing.')
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path))
    if (raw && !raw.endsWith('\n')) throw new Error('Remote event journal has a torn record; refusing to skip events.')
    const events = raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as RemoteSessionEvent)
    for (let index = 0; index < events.length; index++) if (events[index].protocolVersion !== 1 || events[index].sessionId !== id || events[index].sequence !== index + 1) throw new Error('Remote event sequence is corrupt; refusing to skip events.')
    this.cache.set(id, { bytes, ino: info.ino, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, events })
    return events
  }
  private emit(id: string, event: RemoteSessionEvent['event']): void {
    withStateLock(`${this.file(id)}.events-lock`, () => {
      const events = this.journal(id)
      const sequence = events.length + 1
      const record: RemoteSessionEvent = { protocolVersion: 1, sequence, sessionId: id, event }
      const line = `${JSON.stringify(record)}\n`
      const bytes = Buffer.byteLength(line)
      if (bytes > 1024 * 1024) throw new Error('Remote event exceeds 1 MiB.')
      const previousBytes = existsSync(this.eventsFile(id)) ? statSync(this.eventsFile(id)).size : 0
      if (previousBytes + bytes > 32 * 1024 * 1024) throw new Error('Remote event journal exceeds its limit.')
      const fd = openSync(this.eventsFile(id), 'a', 0o600)
      try { appendFileSync(fd, line); fsyncSync(fd) } finally { closeSync(fd) }
      events.push(record)
      const info = statSync(this.eventsFile(id))
      this.cache.set(id, { bytes: previousBytes + bytes, ino: info.ino, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, events })
    })
    for (const wake of this.waiters.get(id) ?? []) wake()
    this.waiters.delete(id)
  }
  private attach(record: RemoteRecord): void {
    if (record.status === 'closed') throw new Error('Remote session is closed.')
    if (record.status === 'running' && !this.active.has(record.id)) {
      if (ownerMayBeAlive(record.owner) || isProcessAlive(record.childPid)) throw new Error('Remote session still has a live worker; refusing duplicate execution.')
      if (record.launchIntent && !record.childPid && !this.options.runPrompt && !this.options.dryRun) throw new Error('Interrupted worker has no durable process identity; inspect processes before resuming.')
      const last = this.journal(record.id).at(-1)?.event
      this.change(record.id, current => {
        current.status = last?.type === 'result' ? 'completed' : 'interrupted'
        if (last?.type === 'result') current.result = { stopReason: last.stopReason }
        delete current.owner; delete current.childPid
      })
      if (last?.type !== 'result') this.emit(record.id, { type: 'error', message: 'Remote worker was interrupted. Saved tool outcomes may be unknown; resume to inspect and reconcile without blindly repeating effects.' })
    }
    if (!this.runtime.sessions.has(record.runtimeId)) {
      this.runtime.resumeSession(record.runtimeId, record.cwd)
      // A known initial CLI UUID is persisted before launch, even if init never reached the parent.
      if (record.launchIntent) this.runtime.sessions.get(record.runtimeId)!.cliSessionId ??= record.runtimeId
    }
  }
  newSession(cwd: string): { sessionId: string; workspaceRoot: string } {
    const created = this.runtime.newSession(cwd), at = new Date().toISOString()
    const record: RemoteRecord = { version: 1, id: `sess_${created.sessionId}`, runtimeId: created.sessionId, cwd, status: 'idle', createdAt: at, updatedAt: at, requests: {} }
    atomicWriteJson(this.file(record.id), record)
    return { sessionId: record.id, workspaceRoot: cwd }
  }
  has(id: string): boolean { return sessionPattern.test(id) && existsSync(this.file(id)) }
  promptReceipt(id: string, requestId: string): { promptSha256: string; runId: string } | undefined {
    return this.read(id).requests[requestId]
  }
  resume(id: string) {
    let record = this.read(id)
    if (record.status === 'closed') { this.change(id, current => { current.status = 'idle' }); record = this.read(id) }
    this.attach(record)
    return { sessionId: id, workspaceRoot: record.cwd, lastSequence: this.journal(id).length }
  }
  async prompt(id: string, prompt: string, requestId: string = randomUUID(), control?: AcpPromptControl) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 128000 || prompt.includes('\0')) throw new Error('Invalid remote prompt (1..128000 characters).')
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(requestId)) throw new Error('Invalid prompt requestId.')
    const record = this.read(id); this.attach(record)
    const promptSha256 = hash(prompt)
    const prior = record.requests[requestId]
    if (prior) { if (prior.promptSha256 !== promptSha256) throw new Error('Prompt requestId already belongs to different content.'); return { sessionId: id, runId: prior.runId } }
    if (this.active.has(id)) throw new Error('Session already has a prompt in flight.')
    const runId = randomUUID()
    const claimedRunId = this.change(id, current => {
      const existing = current.requests[requestId]
      if (existing) {
        if (existing.promptSha256 !== promptSha256) throw new Error('Prompt requestId already belongs to different content.')
        return existing.runId
      }
      if (current.status === 'running' && ownerMayBeAlive(current.owner)) throw new Error('Session already has a live prompt.')
      if (Object.keys(current.requests).length >= 1000) throw new Error('Remote session request limit reached; start another session.')
      current.requests[requestId] = { promptSha256, runId }; current.runId = runId; current.status = 'running'; current.owner = makeProcessOwner()
      delete current.childPid; delete current.error; delete current.result
      return runId
    })
    if (claimedRunId !== runId) return { sessionId: id, runId: claimedRunId }
    const recovering = record.status === 'interrupted' || record.status === 'running'
    const actualPrompt = recovering ? `The previous remote run was interrupted. Its effects may be UNKNOWN. Inspect saved work and relevant external state before choosing how to reconcile; do not blindly repeat commands.\n\n${prompt}` : prompt
    if (control) this.controls.set(record.runtimeId, control)
    let failed = false
    const running = this.runtime.prompt(record.runtimeId, [{ type: 'text', text: actualPrompt }], {
      onUpdate: update => this.emit(id, { type: 'session/update', update }),
      requestPermission: (request, signal) => new Promise<acp.RequestPermissionResponse>(resolve => {
        const permissionId = randomUUID()
        const finish = (decision: acp.RequestPermissionResponse): void => {
          const pending = this.permissions.get(permissionId)
          if (!pending) return
          clearTimeout(pending.timer); signal.removeEventListener('abort', cancel)
          this.permissions.delete(permissionId); resolve(decision)
        }
        const cancel = () => finish({ outcome: { outcome: 'cancelled' } })
        const timer = setTimeout(cancel, 5 * 60_000)
        this.permissions.set(permissionId, { sessionId: id, resolve: finish, timer })
        signal.addEventListener('abort', cancel, { once: true })
        this.emit(id, { type: 'permission', requestId: permissionId, request: { ...request, sessionId: id } })
        if (signal.aborted) cancel()
      }),
    }).then(result => {
      this.emit(id, { type: 'result', stopReason: result.stopReason })
      this.change(id, current => { current.status = 'completed'; current.result = result; delete current.owner; delete current.childPid })
      return result
    }).catch(error => {
      failed = true
      const message = String(error)
      try { this.emit(id, { type: 'error', message }) } catch { /* A corrupt/full journal is retained and reported through metadata. */ }
      this.change(id, current => { current.status = 'interrupted'; current.error = message; delete current.owner; delete current.childPid })
    }).finally(() => {
      this.active.delete(id); this.controls.delete(record.runtimeId)
      try { control?.onComplete?.(failed) } catch {
        this.change(id, current => { current.error = 'Team accounting could not be persisted; inspect the private quota state before continuing.' })
      }
    })
    this.active.set(id, running)
    return { sessionId: id, runId }
  }
  async events(id: string, after = 0, waitMs = 0) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 25000) throw new Error('Invalid event cursor/waitMs.')
    let record = this.read(id), events = this.journal(id)
    if (after > events.length) throw new Error('Event cursor is ahead of the durable journal.')
    if (after === events.length && record.status === 'running' && waitMs > 0) {
      await new Promise<void>(resolve => {
        const wake = () => { clearTimeout(timer); this.waiters.get(id)?.delete(wake); resolve() }
        const timer = setTimeout(wake, waitMs)
        const waiters = this.waiters.get(id) ?? new Set(); waiters.add(wake); this.waiters.set(id, waiters)
      })
      record = this.read(id); events = this.journal(id)
    }
    const page: RemoteSessionEvent[] = []
    let size = 0
    for (const event of events.slice(after)) { const bytes = Buffer.byteLength(JSON.stringify(event)); if (size + bytes > 2 * 1024 * 1024) break; page.push(event); size += bytes }
    return { protocolVersion: 1 as const, events: page, nextCursor: after + page.length, done: record.status !== 'running' && after + page.length === events.length,
      ...(record.result ? { result: record.result } : {}), ...(record.error ? { error: record.error } : {}) }
  }
  approve(id: string, requestId: string, decision: { behavior?: unknown }) {
    this.read(id)
    if (decision?.behavior !== 'allow' && decision?.behavior !== 'deny') throw new Error('Permission decision must explicitly allow or deny.')
    const key = `${id}:${requestId}`, prior = this.decisions.get(key)
    if (prior) { if (prior !== decision.behavior) throw new Error('Permission request already has a different decision.'); return { accepted: true } }
    const pending = this.permissions.get(requestId)
    if (!pending || pending.sessionId !== id) return { accepted: false }
    this.decisions.set(key, decision.behavior)
    if (this.decisions.size > 10000) this.decisions.delete(this.decisions.keys().next().value!)
    pending.resolve({ outcome: { outcome: 'selected', optionId: decision.behavior === 'allow' ? 'allow_once' : 'reject_once' } })
    return { accepted: true }
  }
  cancel(id: string) { const record = this.read(id), canceled = this.active.has(id); this.runtime.cancel(record.runtimeId); return { sessionId: id, canceled } }
  async close(id: string) {
    const record = this.read(id)
    if (record.status === 'closed') return { sessionId: id, closed: false, canceled: false }
    const canceled = this.active.has(id)
    if (this.runtime.sessions.has(record.runtimeId)) await this.runtime.close(record.runtimeId)
    this.change(id, current => { current.status = 'closed'; delete current.owner; delete current.childPid })
    return { sessionId: id, closed: true, canceled }
  }
  async stop() {
    for (const id of this.active.keys()) { try { this.cancel(id) } catch {} }
    for (const pending of this.permissions.values()) pending.resolve({ outcome: { outcome: 'cancelled' } })
    this.permissions.clear()
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([Promise.allSettled([...this.active.values()]), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000) })]) }
    finally { if (timer) clearTimeout(timer) }
    for (const waiters of this.waiters.values()) for (const wake of waiters) wake()
    this.waiters.clear()
  }
  private devices(): Device[] { const path = join(this.store, 'devices.json'); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Device[] : [] }
  private saveDevices(devices: Device[]) { atomicWriteJson(join(this.store, 'devices.json'), devices) }
  pair(sessionIds: string[], expiresInMs = 24 * 60 * 60_000) {
    if (!this.options.token) throw new Error('Device pairing requires an operator bearer token.')
    if (!Array.isArray(sessionIds) || !sessionIds.length || sessionIds.length > 100 || sessionIds.some(id => !this.has(id))) throw new Error('Device session scope must name existing sessions.')
    if (!Number.isSafeInteger(expiresInMs) || expiresInMs < 60000 || expiresInMs > 30 * 24 * 60 * 60_000) throw new Error('Device expiry must be between 1 minute and 30 days.')
    const token = `ur_device_${randomBytes(32).toString('base64url')}`, device: Device = { id: randomUUID(), tokenSha256: hash(token), sessionIds, expiresAt: new Date(Date.now() + expiresInMs).toISOString() }
    withStateLock(join(this.store, 'devices.lock'), () => { const devices = this.devices(); if (devices.length >= 1000) throw new Error('Device registry limit reached.'); devices.push(device); this.saveDevices(devices) })
    return { deviceId: device.id, token, expiresAt: device.expiresAt, sessionIds }
  }
  deviceFor(request: Request): Device | undefined {
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/iu)?.[1]
    if (!token || token.length > 256) return undefined
    return this.devices().find(device => device.tokenSha256 === hash(token) && !device.revokedAt && Date.parse(device.expiresAt) > Date.now())
  }
  deviceAllowed(device: Device, method: string, params?: Record<string, unknown>): boolean {
    return method === 'initialize' || ['session/prompt', 'session/events', 'session/approve', 'session/cancel', 'session/resume', 'session/close'].includes(method) && typeof params?.sessionId === 'string' && device.sessionIds.includes(params.sessionId)
  }
  revoke(deviceId: string) {
    return withStateLock(join(this.store, 'devices.lock'), () => { const devices = this.devices(), device = devices.find(item => item.id === deviceId); if (!device) return { revoked: false }; device.revokedAt = new Date().toISOString(); this.saveDevices(devices); for (const waiters of this.waiters.values()) for (const wake of waiters) wake(); return { revoked: true } })
  }
}
export function createAcpHttpSessionManager(options: AcpHttpSessionOptions) { return new AcpHttpSessionManager(options) }
