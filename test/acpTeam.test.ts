import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AcpTeamController, type AcpTeamPolicy, loadAcpTeamPolicy } from '../src/services/agents/acpTeam.js'
import { createAcpHttpSessionManager, type AcpHttpSessionManager } from '../src/services/agents/acpHttpSessions.js'
import { handleAcpRequest } from '../src/services/agents/acpServer.js'

const roots: string[] = [], managers: AcpHttpSessionManager[] = []
const children: ReturnType<typeof Bun.spawn>[] = []
afterEach(async () => {
  for (const child of children.splice(0)) { try { child.kill('SIGKILL') } catch {} await child.exited }
  await Promise.all(managers.splice(0).map(manager => manager.stop()))
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})
const root = resolve(import.meta.dir, '..')
function temp() { const path = realpathSync(mkdtempSync(join(tmpdir(), 'ur-acp-team-'))); roots.push(path); return path }
function fixture(patch: Partial<AcpTeamPolicy> = {}) {
  const cwd = temp(), state = temp(), policyPath = join(temp(), 'policy.json')
  const policy: AcpTeamPolicy = { version: 1, teamId: 'test', budget: { maxPrompts: 3, maxConcurrentPrompts: 1 },
    members: { member: { role: 'member', maxPrompts: 2, secretEnvNames: ['ALLOWED_TOKEN'] }, viewer: { role: 'viewer' }, reviewer: { role: 'reviewer' } }, ...patch }
  writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 })
  return { cwd, state, policyPath, policy, controller: () => new AcpTeamController(policyPath, cwd, state, {
    PATH: process.env.PATH, ALLOWED_TOKEN: 'fake-allowed', DENIED_TOKEN: 'fake-denied', UR_ACP_TOKEN: 'fake-operator', UR_REMOTE_STATE_DIR: state,
    HTTP_PROXY: 'http://fake-user:fake-password@localhost', UNCLASSIFIED_VALUE: 'fake-sensitive-value',
  }) }
}
const sessionId = 'sess_12345678-1234-1234-1234-123456789abc'
const request = (id: string) => ({ sessionId, stream: true, prompt: 'task', requestId: id })

test('opt-in team policy requires administrator paths and validates bounds; no repository-controlled activation', () => {
  const f = fixture()
  expect(loadAcpTeamPolicy(f.policyPath, f.cwd).policy.teamId).toBe('test')
  expect(() => loadAcpTeamPolicy('relative.json', f.cwd)).toThrow('absolute')
  const projectPolicy = join(f.cwd, 'policy.json'); writeFileSync(projectPolicy, JSON.stringify(f.policy))
  expect(() => loadAcpTeamPolicy(projectPolicy, f.cwd)).toThrow('outside')
  expect(() => new AcpTeamController(f.policyPath, f.cwd, join(f.cwd, 'state'))).toThrow('UR_REMOTE_STATE_DIR')
  writeFileSync(f.policyPath, JSON.stringify({ ...f.policy, budget: { maxPrompts: 1.5, maxConcurrentPrompts: 1 } }))
  expect(() => f.controller()).toThrow('Invalid team policy')
})

test('durable shared/member/concurrency quotas are idempotent and exact-principal bound', () => {
  const f = fixture(), first = f.controller().reserve('member', request('one'))
  const duplicate = f.controller().reserve('member', request('one'))
  expect(duplicate.duplicate).toBe(true)
  expect(f.controller().status('operator').consumed).toBe(1)
  expect(() => f.controller().reserve('operator', request('one'))).toThrow('different principal')
  expect(() => f.controller().reserve('member', request('two'))).toThrow('concurrent')
  first.finish()
  const second = f.controller().reserve('member', request('two')); second.finish()
  expect(() => f.controller().reserve('member', request('three'))).toThrow('Member prompt budget')
  const operator = f.controller().reserve('operator', request('operator')); operator.finish()
  expect(() => f.controller().reserve('operator', request('overflow'))).toThrow('Shared team prompt budget')
  expect(f.controller().status('member')).toMatchObject({ consumed: 3, principal: { consumed: 2 }, monetaryCost: 'not-measured' })
})

test('roles, reviewed automation digest/session/principal and scoped secrets preserve benign supported work', () => {
  const f = fixture({ requireReviewedAutomation: true, automations: { approved: { sessionId,
    promptSha256: createHash('sha256').update('task').digest('hex'), principals: ['member'], reviewedBy: 'operator', reviewedAt: new Date().toISOString() } } })
  expect(() => f.controller().authorize('viewer', 'session/prompt')).toThrow('role')
  expect(() => f.controller().authorize('reviewer', 'session/approve')).not.toThrow()
  expect(() => f.controller().authorize('member', 'session/approve')).toThrow('role')
  expect(() => f.controller().reserve('member', request('missing-review'))).toThrow('reviewed automation')
  expect(() => f.controller().reserve('member', { ...request('tampered'), automationId: 'approved', prompt: 'different' })).toThrow('reviewed automation')
  const reservation = f.controller().reserve('member', { ...request('approved'), automationId: 'approved' })
  expect(reservation.env.ALLOWED_TOKEN).toBe('fake-allowed')
  expect(reservation.env.DENIED_TOKEN).toBeUndefined()
  expect(reservation.env.UR_ACP_TOKEN).toBeUndefined()
  expect(reservation.env.UR_REMOTE_STATE_DIR).toBeUndefined()
  expect(reservation.env.HTTP_PROXY).toBeUndefined()
  expect(reservation.env.UNCLASSIFIED_VALUE).toBeUndefined()
  expect(reservation.env.UR_CONFIG_DIR).toBe(join(f.state, 'team-sessions', sessionId))
  const child = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify({allowed:process.env.ALLOWED_TOKEN,denied:process.env.DENIED_TOKEN,operator:process.env.UR_ACP_TOKEN}))'], { env: reservation.env, encoding: 'utf8', timeout: 5000 })
  expect(child.status).toBe(0)
  expect(JSON.parse(child.stdout)).toEqual({ allowed: 'fake-allowed' })
  reservation.finish()
  const exported = f.controller().exportAudit('operator')
  expect(exported.entries.length).toBeGreaterThan(0)
  expect(JSON.stringify(exported)).not.toContain('fake-allowed')
  expect(JSON.stringify(exported)).not.toContain('fake-denied')
  expect(() => f.controller().exportAudit('viewer')).toThrow('operator')
})

test('audit export verifies its hash chain and refuses changed or torn history', () => {
  const f = fixture()
  f.controller().audit('operator', 'initialize', 'accepted')
  const path = join(f.state, 'team-test.audit.jsonl'), original = readFileSync(path, 'utf8')
  expect(f.controller().exportAudit('operator').entries[0]!.sequence).toBe(1)
  writeFileSync(path, original.replace('accepted', 'tampered'))
  expect(() => f.controller().exportAudit('operator')).toThrow('chain verification')
  writeFileSync(path, original.slice(0, -1))
  expect(() => f.controller().exportAudit('operator')).toThrow('torn record')
})

test('a killed reservation retains unknown concurrency until explicit operator reconciliation', async () => {
  const f = fixture()
  const url = pathToFileURL(join(root, 'src/services/agents/acpTeam.ts')).href
  const child = Bun.spawn([process.execPath, '--preload', join(root, 'plugins/bunBundleDev.ts'), '-e',
    `import{AcpTeamController}from ${JSON.stringify(url)};const c=new AcpTeamController(...JSON.parse(process.argv[1]));const r=c.reserve('member',${JSON.stringify(request('interrupted'))});console.log(r.receiptId);await new Promise(()=>{})`,
    '--', JSON.stringify([f.policyPath, f.cwd, f.state])], { stdout: 'pipe', stderr: 'pipe' })
  children.push(child)
  const reader = child.stdout.getReader(); const part = await reader.read(); reader.releaseLock()
  const id = new TextDecoder().decode(part.value).trim()
  expect(id).toMatch(/^[a-f0-9]{64}$/u)
  child.kill('SIGKILL'); await child.exited
  expect(f.controller().status('operator')).toMatchObject({ consumed: 1, activeOrUnknown: 1, principal: { unknown: 1 } })
  expect(() => f.controller().reserve('member', request('next'))).toThrow('concurrent')
  expect(() => f.controller().reconcile('member', id, 'reviewed')).toThrow('Operator')
  expect(f.controller().reconcile('operator', id, 'Reviewed surviving processes and side effects.').reconciled).toBe(true)
  const next = f.controller().reserve('member', request('next')); next.finish()
  expect(f.controller().status('operator').consumed).toBe(2)
}, 60_000)

test('authenticated ACP dispatch enforces team roles and quota across devices; revoked members cannot regain scope', async () => {
  const f = fixture()
  let starts = 0, finish: (() => void) | undefined
  const manager = createAcpHttpSessionManager({ cwd: f.cwd, stateDir: f.state, token: 'operator', runPrompt: async () => {
    starts++; await new Promise<void>(resolve => { finish = resolve }); return { stopReason: 'end_turn' }
  } }); managers.push(manager)
  const firstSession = manager.newSession(f.cwd).sessionId, secondSession = manager.newSession(f.cwd).sessionId
  const paired = manager.pair([firstSession, secondSession]), viewer = manager.pair([firstSession])
  writeFileSync(f.policyPath, JSON.stringify({ ...f.policy, members: { [paired.deviceId]: { role: 'member' }, [viewer.deviceId]: { role: 'viewer' } } }))
  const rpc = async (method: string, params: Record<string, unknown> = {}, token = 'operator') => {
    const response = await handleAcpRequest(new Request('http://localhost/acp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), { cwd: f.cwd, host: '127.0.0.1', port: 0, token: 'operator', sessionManager: manager, teamPolicyPath: f.policyPath })
    return { status: response.status, body: await response.json() as any }
  }
  expect((await rpc('session/prompt', { sessionId: firstSession, prompt: 'task', stream: true }, viewer.token)).status).toBe(403)
  const first = await rpc('session/prompt', { sessionId: firstSession, prompt: 'task', stream: true, requestId: 'one' }, paired.token)
  expect(first.status).toBe(200)
  const duplicate = await rpc('session/prompt', { sessionId: firstSession, prompt: 'task', stream: true, requestId: 'one' }, paired.token)
  expect(duplicate.body.result.runId).toBe(first.body.result.runId)
  expect((await rpc('session/prompt', { sessionId: secondSession, prompt: 'task', stream: true, requestId: 'two' }, paired.token)).status).toBe(429)
  expect((await rpc('team/status', {}, paired.token)).body.result.consumed).toBe(1)
  expect((await rpc('team/audit', {}, paired.token)).status).toBe(403)
  expect((await rpc('tools/call', { name: 'Read', arguments: {} })).status).toBe(403)
  expect(starts).toBe(1)
  finish!()
  for (let tries = 0; tries < 100 && !(await manager.events(firstSession)).done; tries++) await Bun.sleep(10)
  expect((await rpc('team/audit')).body.result.entries.some((entry: any) => entry.outcome === 'finished')).toBe(true)
  manager.revoke(paired.deviceId)
  expect((await rpc('team/status', {}, paired.token)).status).toBe(401)
})

test('actual default ACP runner spawns its literal scoped environment without changing parent credentials', () => {
  const f = fixture(), cli = join(f.cwd, 'fake-cli.ts'), wrapper = join(f.cwd, 'wrapper.ts')
  writeFileSync(cli, `
import{createInterface}from'node:readline';const input=createInterface({input:process.stdin});
input.on('line',line=>{if(JSON.parse(line).type!=='user')return;
const text=JSON.stringify({allowed:process.env.ALLOWED_TOKEN,denied:process.env.DENIED_TOKEN,operator:process.env.UR_ACP_TOKEN});
console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}}));
process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false})+'\\n',()=>process.exit(0));});
`)
  const url = pathToFileURL(join(root, 'src/services/agents/acpStdio.ts')).href
  writeFileSync(wrapper, `
import{defaultAcpPromptRunner}from ${JSON.stringify(url)};process.argv[1]=${JSON.stringify(cli)};
const chunks=[];const result=await defaultAcpPromptRunner('fixture',{sessionId:'12345678-1234-1234-1234-123456789abc',cwd:process.cwd(),signal:new AbortController().signal,additionalDirectories:[],mcpServers:[],mode:'default',env:{PATH:process.env.PATH,ALLOWED_TOKEN:'fake-allowed'},onChunk:text=>{chunks.push(text)},onToolUpdate:()=>{},requestPermission:async()=>({outcome:{outcome:'cancelled'}})});
console.log('ACP_ENV_RESULT '+JSON.stringify({result,observed:JSON.parse(chunks.join('')),parent:process.env.DENIED_TOKEN}));
`)
  const child = spawnSync(process.execPath, ['run', '--preload', join(root, 'plugins/bunBundleDev.ts'), wrapper], {
    cwd: f.cwd, encoding: 'utf8', timeout: 15_000, env: { PATH: process.env.PATH, DENIED_TOKEN: 'fake-parent-denied', UR_ACP_TOKEN: 'fake-parent-operator' },
  })
  expect(child.status, child.stderr).toBe(0)
  const line = child.stdout.split('\n').find(line => line.startsWith('ACP_ENV_RESULT '))
  expect(line).toBeDefined()
  expect(JSON.parse(line!.slice('ACP_ENV_RESULT '.length))).toMatchObject({ result: { stopReason: 'end_turn' }, observed: { allowed: 'fake-allowed' }, parent: 'fake-parent-denied' })
  expect(JSON.parse(line!.slice('ACP_ENV_RESULT '.length)).observed).not.toHaveProperty('denied')
})

test('separate controller processes cannot both claim the final shared concurrency slot', async () => {
  const f = fixture(), url = pathToFileURL(join(root, 'src/services/agents/acpTeam.ts')).href
  const starts = ['alpha', 'beta'].map(id => {
    const child = Bun.spawn([process.execPath, '--preload', join(root, 'plugins/bunBundleDev.ts'), '-e', `
import{AcpTeamController}from ${JSON.stringify(url)};
try{new AcpTeamController(...JSON.parse(process.argv[1])).reserve('member',${JSON.stringify(request(id))});console.log('accepted')}catch{console.log('rejected')}
await new Promise(resolve=>setTimeout(resolve,20000));`, '--', JSON.stringify([f.policyPath, f.cwd, f.state])], { stdout: 'pipe', stderr: 'pipe' })
    children.push(child)
    return child
  })
  const results = await Promise.all(starts.map(async child => { const reader = child.stdout.getReader(); const next = await reader.read(); reader.releaseLock(); return new TextDecoder().decode(next.value).trim() }))
  expect(results.sort()).toEqual(['accepted', 'rejected'])
  expect(f.controller().status('operator')).toMatchObject({ consumed: 1, activeOrUnknown: 1 })
}, 60_000)

test('corrupt team audit fails before a model or tool side effect is dispatched', async () => {
  const f = fixture(); let starts = 0
  const manager = createAcpHttpSessionManager({ cwd: f.cwd, stateDir: f.state, token: 'operator', runPrompt: async () => { starts++; return { stopReason: 'end_turn' } } }); managers.push(manager)
  const id = manager.newSession(f.cwd).sessionId
  f.controller().audit('operator', 'initialize', 'accepted')
  const audit = join(f.state, 'team-test.audit.jsonl')
  writeFileSync(audit, readFileSync(audit, 'utf8').replace('accepted', 'tampered'))
  const response = await handleAcpRequest(new Request('http://localhost/acp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer operator' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { sessionId: id, stream: true, prompt: 'do work', requestId: 'blocked' } }) }),
  { cwd: f.cwd, host: '127.0.0.1', port: 0, token: 'operator', sessionManager: manager, teamPolicyPath: f.policyPath })
  expect(response.status).toBe(403)
  expect((await response.json() as any).error.message).toContain('chain verification')
  expect(starts).toBe(0)
})
