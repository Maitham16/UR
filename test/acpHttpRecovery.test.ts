import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAcpHttpSessionManager, type AcpHttpSessionManager } from '../src/services/agents/acpHttpSessions.js'
import { handleAcpRequest, stopAcpServer } from '../src/services/agents/acpServer.js'
import type { AcpPromptRunner } from '../src/services/agents/acpStdio.js'

const roots: string[] = [], managers: AcpHttpSessionManager[] = []
const children: ReturnType<typeof Bun.spawn>[] = []
let server: ReturnType<typeof Bun.serve> | undefined
afterEach(async () => {
  for (const child of children.splice(0)) { try { child.kill('SIGKILL') } catch {} await child.exited }
  await Promise.all(managers.splice(0).map(manager => manager.stop()))
  server?.stop(true); server = undefined
  await stopAcpServer()
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})
function temp() { const cwd = mkdtempSync(join(tmpdir(), 'ur-http-recovery-')); roots.push(cwd); return cwd }
function manager(cwd: string, runPrompt: AcpPromptRunner) { const result = createAcpHttpSessionManager({ cwd, token: 'operator-secret', runPrompt }); managers.push(result); return result }
async function until(predicate: () => boolean) { const deadline = Date.now() + 10000; while (!predicate()) { if (Date.now() > deadline) throw new Error('fixture timed out'); await Bun.sleep(10) } }
function network(cwd: string, sessionManager: AcpHttpSessionManager) {
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => handleAcpRequest(request, { cwd, sessionManager, host: '127.0.0.1', port: 0, token: 'operator-secret' }) })
  return async (method: string, params: Record<string, unknown> = {}, token = 'operator-secret') => {
    const response = await fetch(`http://127.0.0.1:${server!.port}/acp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    return { status: response.status, body: await response.json() as { result?: any; error?: any } }
  }
}

describe('authenticated durable HTTP control', () => {
  test('real HTTP permission roundtrip and idempotent prompt delivery preserve event order', async () => {
    const cwd = temp(); let starts = 0
    const sessionManager = manager(cwd, async (_prompt, context) => {
      starts++
      await context.onChunk('Inspecting the task')
      const decision = await context.requestPermission({ toolCall: { toolCallId: 'write-one', title: 'Write the requested file', rawInput: { file_path: 'effect.txt' } }, options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' }] })
      if (decision.outcome.outcome === 'selected' && decision.outcome.optionId === 'allow_once') writeFileSync(join(cwd, 'effect.txt'), 'approved once')
      return { stopReason: 'end_turn', resumeSessionId: context.sessionId }
    })
    const rpc = network(cwd, sessionManager)
    expect((await rpc('initialize', {}, 'wrong')).status).toBe(401)
    const sessionId = (await rpc('session/new')).body.result.sessionId
    const first = await rpc('session/prompt', { sessionId, prompt: 'write a file', stream: true, requestId: 'delivery-one' })
    const duplicate = await rpc('session/prompt', { sessionId, prompt: 'write a file', stream: true, requestId: 'delivery-one' })
    expect(duplicate.body.result.runId).toBe(first.body.result.runId)
    expect((await rpc('session/prompt', { sessionId, prompt: 'different task', stream: true, requestId: 'delivery-one' })).body.error).toBeDefined()
    let page = (await rpc('session/events', { sessionId, after: 0 })).body.result
    while (!page.events.some((event: any) => event.event.type === 'permission')) { await Bun.sleep(10); page = (await rpc('session/events', { sessionId, after: 0 })).body.result }
    const permission = page.events.find((event: any) => event.event.type === 'permission').event
    expect(existsSync(join(cwd, 'effect.txt'))).toBe(false)
    expect((await rpc('session/approve', { sessionId, requestId: permission.requestId, decision: { behavior: 'allow' } })).body.result.accepted).toBe(true)
    expect((await rpc('session/approve', { sessionId, requestId: permission.requestId, decision: { behavior: 'deny' } })).body.error).toBeDefined()
    await until(() => existsSync(join(cwd, 'effect.txt')))
    let final = (await rpc('session/events', { sessionId, after: 0 })).body.result
    while (!final.done) { await Bun.sleep(10); final = (await rpc('session/events', { sessionId, after: 0 })).body.result }
    expect(final.events.map((event: any) => event.sequence)).toEqual(final.events.map((_: any, index: number) => index + 1))
    expect(final.events.every((event: any) => event.sessionId === sessionId && event.protocolVersion === 1)).toBe(true)
    expect(final.result.stopReason).toBe('end_turn')
    expect(starts).toBe(1)
    expect(readFileSync(join(cwd, 'effect.txt'), 'utf8')).toBe('approved once')
    expect((await rpc('session/events', { sessionId, after: 100000 })).body.error.message).toContain('ahead')
  })

  test('server recreation replays the same events and resumes the same saved CLI session', async () => {
    const cwd = temp(); let firstId = '', firstStarts = 0, resumedId = ''
    const first = manager(cwd, async (_prompt, context) => { firstStarts++; firstId = context.sessionId; await context.onChunk('first output'); return { stopReason: 'end_turn', resumeSessionId: context.sessionId } })
    const { sessionId } = first.newSession(cwd)
    await first.prompt(sessionId, 'first', 'first')
    await until(() => firstStarts === 1)
    let page = await first.events(sessionId)
    while (!page.done) { await Bun.sleep(10); page = await first.events(sessionId) }
    await first.stop()
    const second = manager(cwd, async (_prompt, context) => { resumedId = context.resumeSessionId!; await context.onChunk('second output'); return { stopReason: 'end_turn', resumeSessionId: context.resumeSessionId } })
    expect(second.resume(sessionId).lastSequence).toBe(page.nextCursor)
    expect((await second.events(sessionId)).events).toEqual(page.events)
    await second.prompt(sessionId, 'continue', 'second')
    await until(() => resumedId.length > 0)
    expect(resumedId).toBe(firstId)
    expect(firstStarts).toBe(1)
  })

  test('the locked prompt claim rechecks a stale read after another process completed the same request', async () => {
    const cwd = temp(); let starts = 0, duplicateStarts = 0
    const first = manager(cwd, async () => { starts++; return { stopReason: 'end_turn' } })
    const { sessionId } = first.newSession(cwd)
    const metadata = join(cwd, `.ur/remote/http/${sessionId}.json`)
    const stale = JSON.parse(readFileSync(metadata, 'utf8'))
    const original = await first.prompt(sessionId, 'one effect', 'delivery')
    while (!(await first.events(sessionId)).done) await Bun.sleep(10)
    const second = manager(cwd, async () => { duplicateStarts++; return { stopReason: 'end_turn' } })
    // Deterministically reproduce a paused process holding the pre-claim read.
    const internal = second as unknown as { read: (id: string) => unknown }
    const read = internal.read.bind(second)
    let firstRead = true
    internal.read = id => { if (firstRead) { firstRead = false; return stale } return read(id) }
    expect(await second.prompt(sessionId, 'one effect', 'delivery')).toEqual(original)
    expect(starts).toBe(1)
    expect(duplicateStarts).toBe(0)
    firstRead = true
    await expect(second.prompt(sessionId, 'different effect', 'delivery')).rejects.toThrow('different content')
    expect(duplicateStarts).toBe(0)
  })

  test('scoped expiring device credentials cannot read other sessions or approve after revocation', async () => {
    const cwd = temp(), sessionManager = manager(cwd, async () => ({ stopReason: 'end_turn' }))
    const rpc = network(cwd, sessionManager)
    const sessionId = (await rpc('session/new')).body.result.sessionId
    const otherId = (await rpc('session/new')).body.result.sessionId
    const paired = (await rpc('device/new', { sessionIds: [sessionId], expiresInMs: 60000 })).body.result
    expect((await rpc('session/events', { sessionId }, paired.token)).status).toBe(200)
    expect((await rpc('session/events', { sessionId: otherId }, paired.token)).status).toBe(403)
    expect((await rpc('device/new', { sessionIds: [sessionId] }, paired.token)).status).toBe(403)
    expect((await rpc('device/revoke', { deviceId: paired.deviceId })).body.result.revoked).toBe(true)
    expect((await rpc('session/events', { sessionId }, paired.token)).status).toBe(401)
    const persisted = readFileSync(join(cwd, '.ur/remote/http/devices.json'), 'utf8')
    expect(persisted).not.toContain(paired.token)
  })

  test('a torn journal fails explicitly and permission cancellation never writes the file', async () => {
    const cwd = temp(); let permissionStarted = false
    const sessionManager = manager(cwd, async (_prompt, context) => {
      permissionStarted = true
      const response = await context.requestPermission({ toolCall: { toolCallId: 'write', title: 'Write file' }, options: [{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' }] })
      if (response.outcome.outcome !== 'cancelled') writeFileSync(join(cwd, 'unsafe'), 'unexpected')
      return { stopReason: context.signal.aborted ? 'cancelled' : 'end_turn', resumeSessionId: context.sessionId }
    })
    const { sessionId } = sessionManager.newSession(cwd)
    await sessionManager.prompt(sessionId, 'write', 'write')
    await until(() => permissionStarted)
    expect(sessionManager.cancel(sessionId).canceled).toBe(true)
    let page = await sessionManager.events(sessionId)
    while (!page.done) { await Bun.sleep(10); page = await sessionManager.events(sessionId) }
    expect(page.result?.stopReason).toBe('cancelled')
    expect(existsSync(join(cwd, 'unsafe'))).toBe(false)
    appendFileSync(join(cwd, `.ur/remote/http/${sessionId}.jsonl`), '{"partial":')
    await expect(sessionManager.events(sessionId)).rejects.toThrow('torn record')
  })

  test('a real killed server worker exposes interruption and reconciles saved work instead of replaying the effect', async () => {
    const cwd = temp(), url = new URL('../src/services/agents/acpHttpSessions.ts', import.meta.url).href
    const child = Bun.spawn([process.execPath, '-e', `
      import {writeFileSync,appendFileSync} from 'node:fs';
      import {createAcpHttpSessionManager} from ${JSON.stringify(url)};
      const manager=createAcpHttpSessionManager({cwd:${JSON.stringify(cwd)},token:'operator-secret',runPrompt:async(prompt,ctx)=>{
        appendFileSync(${JSON.stringify(join(cwd, 'effect'))},'once\\n');writeFileSync(${JSON.stringify(join(cwd, 'ready'))},ctx.sessionId);setInterval(()=>{},1000);await new Promise(()=>{});
      }}); const {sessionId}=manager.newSession(${JSON.stringify(cwd)});writeFileSync(${JSON.stringify(join(cwd, 'session'))},sessionId);await manager.prompt(sessionId,'work','original');
    `], { env: process.env, stdout: 'pipe', stderr: 'pipe' })
    children.push(child); await until(() => existsSync(join(cwd, 'ready')))
    const sessionId = readFileSync(join(cwd, 'session'), 'utf8'), runtimeId = readFileSync(join(cwd, 'ready'), 'utf8')
    child.kill('SIGKILL'); await child.exited
    let reconciled = false
    const resumed = manager(cwd, async (prompt, context) => {
      expect(context.resumeSessionId).toBe(runtimeId)
      expect(prompt).toContain('do not blindly repeat commands')
      reconciled = true; return { stopReason: 'end_turn', resumeSessionId: runtimeId }
    })
    resumed.resume(sessionId)
    expect((await resumed.events(sessionId)).events.some(event => event.event.type === 'error')).toBe(true)
    await resumed.prompt(sessionId, 'inspect remaining work', 'reconcile')
    await until(() => reconciled)
    expect(readFileSync(join(cwd, 'effect'), 'utf8')).toBe('once\n')
  })
})
