import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAcpHttpSessionManager } from '../src/services/agents/acpHttpSessions.js'
import { handleAcpRequest } from '../src/services/agents/acpServer.js'

test('real HTTP team quota, approval roles, redacted audit and revocation preserve a benign authorized effect', async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'ur-team-http-')))
  const cwd = join(parent, 'workspace'), state = join(parent, 'control'), policyPath = join(parent, 'policy.json')
  mkdirSync(cwd)
  let starts = 0
  const manager = createAcpHttpSessionManager({ cwd, stateDir: state, token: 'operator-fixture', runPrompt: async (_prompt, context) => {
    starts++
    const decision = await context.requestPermission({ toolCall: { toolCallId: 'write', title: 'Write fixture' },
      options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' }] })
    if (decision.outcome.outcome === 'selected' && decision.outcome.optionId === 'allow_once') writeFileSync(join(cwd, 'effect.txt'), 'approved')
    return { stopReason: 'end_turn' }
  } })
  const sessionId = manager.newSession(cwd).sessionId
  const member = manager.pair([sessionId]), reviewer = manager.pair([sessionId]), viewer = manager.pair([sessionId])
  writeFileSync(policyPath, JSON.stringify({ version: 1, teamId: 'http', budget: { maxPrompts: 1, maxConcurrentPrompts: 1 },
    members: { [member.deviceId]: { role: 'member' }, [reviewer.deviceId]: { role: 'reviewer' }, [viewer.deviceId]: { role: 'viewer' } } }), { mode: 0o600 })
  let server: ReturnType<typeof Bun.serve> | undefined
  try {
  server = Bun.serve({ hostname: '127.0.0.1', port: 0,
    fetch: request => handleAcpRequest(request, { cwd, host: '127.0.0.1', port: 0, token: 'operator-fixture', sessionManager: manager, teamPolicyPath: policyPath }) })
  const rpc = async (method: string, params: Record<string, unknown> = {}, token = 'operator-fixture') => {
    const response = await fetch(`http://127.0.0.1:${server!.port}/acp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    return { status: response.status, body: await response.json() as any }
  }
    expect((await rpc('session/prompt', { sessionId, stream: true, prompt: 'write requested fixture' }, viewer.token)).status).toBe(403)
    const params = { sessionId, stream: true, prompt: 'write requested fixture', requestId: 'first' }
    const first = await rpc('session/prompt', params, member.token)
    expect(first.status).toBe(200)
    expect((await rpc('session/prompt', params, member.token)).body.result.runId).toBe(first.body.result.runId)
    let page = (await rpc('session/events', { sessionId }, reviewer.token)).body.result
    const deadline = Date.now() + 5000
    while (!page.events.some((entry: any) => entry.event.type === 'permission')) {
      if (Date.now() > deadline) throw new Error('Permission fixture timed out')
      await Bun.sleep(10); page = (await rpc('session/events', { sessionId }, reviewer.token)).body.result
    }
    const permission = page.events.find((entry: any) => entry.event.type === 'permission').event
    expect(existsSync(join(cwd, 'effect.txt'))).toBe(false)
    expect((await rpc('session/approve', { sessionId, requestId: permission.requestId, decision: { behavior: 'allow' } }, member.token)).status).toBe(403)
    expect((await rpc('session/approve', { sessionId, requestId: permission.requestId, decision: { behavior: 'allow' } }, reviewer.token)).body.result.accepted).toBe(true)
    while (!(await rpc('session/events', { sessionId }, member.token)).body.result.done) {
      if (Date.now() > deadline) throw new Error('Completion fixture timed out')
      await Bun.sleep(10)
    }
    expect(starts).toBe(1)
    expect(readFileSync(join(cwd, 'effect.txt'), 'utf8')).toBe('approved')
    expect((await rpc('session/prompt', { ...params, requestId: 'overflow' }, member.token)).status).toBe(429)
    const audit = (await rpc('team/audit')).body.result
    expect(audit.entries.some((entry: any) => entry.outcome === 'finished')).toBe(true)
    expect(JSON.stringify(audit)).not.toContain(params.prompt)
    expect(JSON.stringify(audit)).not.toContain(member.token)
    expect((await rpc('device/revoke', { deviceId: reviewer.deviceId })).body.result.revoked).toBe(true)
    expect((await rpc('session/events', { sessionId }, reviewer.token)).status).toBe(401)
  } finally { await manager.stop(); server?.stop(true); rmSync(parent, { recursive: true, force: true }) }
}, 60_000)
