import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { query, queryJSON, stream, UrClient, UrRemoteClient } from '../src/sdk/index.js'
import { createServer } from 'node:http'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
const fixture = join(import.meta.dir, 'fixtures/sdk-agent.mjs')
const bin = { file: 'node', args: [fixture] }
const options = (mode: string) => ({ bin, env: { UR_SDK_FIXTURE_MODE: mode }, timeoutMs: 10_000 })

test('local SDK drains split UTF-8 and requires real result plus clean exit', async () => {
  const result = await query('test', options('success'))
  expect(result.ok).toBe(true)
  expect(result.text).toBe('こんにちは café العربية')
  expect(result.sessionId).toBe('sdk-fixture-session')
  expect((await query('test', options('missing'))).error).toContain('without a result')
  expect((await query('test', options('error'))).ok).toBe(false)
  expect(await queryJSON('test', options('error'))).toBeNull()
})

test('local approvals round trip over actual child stdin and default query declines', async () => {
  const run = stream('test', options('permission'))
  const seen = []
  for await (const envelope of run) {
    seen.push(envelope.sequence)
    if (envelope.event.type === 'control_request') await run.approve(String(envelope.event.request_id), { behavior: 'allow', updatedInput: { file_path: '/fixture' } })
  }
  expect((await run.result).text).toBe('allow')
  expect(seen).toEqual([1, 2, 3])
  await expect(run.approve('permission-1', { behavior: 'allow' })).rejects.toThrow('no longer pending')
  expect((await query('test', options('permission'))).text).toBe('deny')
  expect((await query('test', { ...options('permission'), onPermission: () => { throw new Error('UI failure') } })).text).toBe('deny')
})

test('permission wire preserves original input for bare allow and honors only explicit replacements', async () => {
  const original = await query('test', { ...options('permission-input'), onPermission: request => {
    request.input.file_path = '/accidental-mutation'
    return { behavior: 'allow' }
  } })
  expect(original.ok).toBe(true)
  expect(JSON.parse(original.text)).toEqual({ behavior: 'allow', updatedInput: { file_path: '/fixture' } })
  const edited = await query('test', { ...options('permission-input'), onPermission: () => ({ behavior: 'allow', updatedInput: { file_path: '/explicit-replacement' } }) })
  expect(edited.ok).toBe(true)
  expect(JSON.parse(edited.text).updatedInput.file_path).toBe('/explicit-replacement')
  const denied = await query('test', { ...options('permission-input'), onPermission: () => ({ behavior: 'deny' }) })
  expect(denied.ok).toBe(true)
  expect(JSON.parse(denied.text)).toEqual({ behavior: 'deny', message: 'Permission denied by SDK caller' })
})

test('resume uses CLI session identity and prompt option injection is impossible', async () => {
  const client = new UrClient(options('args'))
  const run = client.resume('prior-session', '--dangerously-skip-permissions', { model: 'chosen-model', maxTurns: 3 })
  for await (const _ of run) {}
  const result = await run.result
  const {args: argv, prompt} = JSON.parse(result.text)
  expect(prompt).toBe('--dangerously-skip-permissions')
  expect(argv).not.toContain('--dangerously-skip-permissions')
  expect(argv.slice(argv.indexOf('--resume'), argv.indexOf('--resume') + 2)).toEqual(['--resume', 'prior-session'])
  expect(result.sessionId).toBe('prior-session')
  expect(argv).toContain('--model')
})

test('cancel force terminates an uncooperative child and never reports success', async () => {
  const run = stream('test', options('wait'))
  for await (const _ of run) { run.cancel(); break }
  const result = await run.result
  expect(result.canceled).toBe(true)
  expect(result.ok).toBe(false)
  const aborted = new AbortController(); aborted.abort()
  expect((await query('test', { ...options('wait'), signal: aborted.signal })).canceled).toBe(true)
}, 60_000)

test('malformed or excessive output is explicit failure, including missing executable', async () => {
  expect((await query('test', options('malformed'))).ok).toBe(false)
  expect((await query('test', { ...options('overflow'), maxOutputBytes: 1000 })).error).toContain('exceeded')
  expect((await query('test', { bin: { file: '/does-not-exist/ur' } })).ok).toBe(false)
})

test('published SDK JS runs under Node with no application dependencies', () => {
  const built = spawnSync('node', ['scripts/build-sdk.mjs'], { encoding: 'utf8' })
  expect(built.status, built.stderr).toBe(0)
  const code = `import {query} from './sdk/index.js'; const result=await query('test',${JSON.stringify(options('success'))}); if(!result.ok)throw Error(result.error); console.log(result.text);`
  const result = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 20_000 })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe('こんにちは café العربية')
})

test('isolated packed npm SDK finds its sibling CLI without a global ur or Bun on PATH', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ur-sdk-packed-'))
  try {
    const build = spawnSync('node', ['scripts/build-sdk.mjs'], { encoding: 'utf8' })
    expect(build.status, build.stderr).toBe(0)
    const packageDirectory = join(directory, 'package')
    const consumer = join(directory, 'consumer')
    mkdirSync(join(packageDirectory, 'bin'), { recursive: true }); mkdirSync(consumer)
    cpSync(join(process.cwd(), 'sdk'), join(packageDirectory, 'sdk'), { recursive: true })
    // Exact emitted SDK, with a controlled native-launcher stand-in so this test needs no provider credential.
    cpSync(fixture, join(packageDirectory, 'bin/ur.js'))
    writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ name: 'ur-agent', version: '0.0.0', type: 'module', exports: { './sdk': './sdk/index.js' }, files: ['sdk', 'bin'], bin: { ur: 'bin/ur.js' } }))
    const packed = spawnSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd: packageDirectory, encoding: 'utf8', timeout: 30_000 })
    expect(packed.status, packed.stderr).toBe(0)
    const archive = join(packageDirectory, JSON.parse(packed.stdout)[0].filename)
    const install = spawnSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: consumer, encoding: 'utf8', timeout: 30_000 })
    expect(install.status, install.stderr).toBe(0)
    writeFileSync(join(consumer, 'example.mjs'), `import {query} from 'ur-agent/sdk';const result=await query('packed proof',{timeoutMs:10000});if(!result.ok)throw Error(result.error);console.log(result.text);`)
    // Resolve the Node executable before clearing PATH in the subprocess environment.
    const nodePath = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).stdout.trim()
    const isolated = spawnSync(nodePath, [join(consumer, 'example.mjs')], { cwd: consumer, encoding: 'utf8', timeout: 20_000, env: { ...process.env, UR_EXECUTABLE: '', UR_SDK_FIXTURE_MODE: 'success', PATH: '/no-global-ur-or-bun' } })
    expect(isolated.status, isolated.stderr).toBe(0)
    expect(isolated.stdout.trim()).toBe('こんにちは café العربية')
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 60_000)

test('Python standard-library package exercises real approvals, Unicode, failed results and resume', () => {
  const code = `import json\nfrom ur_agent import UrClient\nc=UrClient(executable='node',executable_args=[${JSON.stringify(fixture)}],timeout=10)\nr=c.query('test'); assert r.ok and r.text=='こんにちは café العربية',r\nr=c.query('test',env={'UR_SDK_FIXTURE_MODE':'permission'}); assert r.text=='deny',r\nr=c.query('test',env={'UR_SDK_FIXTURE_MODE':'permission'},on_permission=lambda p:{'behavior':'allow'}); assert r.text=='allow',r\nr=c.query('test',env={'UR_SDK_FIXTURE_MODE':'error'}); assert not r.ok\nr=c.resume('prior-session','--dangerously-skip-permissions',env={'UR_SDK_FIXTURE_MODE':'args'}).wait(); assert r.ok and r.session_id=='prior-session'\nassert json.loads(r.text)['prompt']=='--dangerously-skip-permissions'\nprint('python sdk passed')`
  const result = spawnSync('python3', ['-c', code], { env: { ...process.env, PYTHONPATH: join(process.cwd(), 'sdk-python') }, encoding: 'utf8', timeout: 20_000 })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe('python sdk passed')
})

test('Python permission wire defaults exact original input and validates caller replacements', () => {
  const code = `import json\nfrom ur_agent import UrClient\nc=UrClient(executable='node',executable_args=[${JSON.stringify(fixture)}],timeout=10,env={'UR_SDK_FIXTURE_MODE':'permission-input'})\ndef bare_allow(p):\n p['input']['file_path']='/accidental-mutation'\n return {'behavior':'allow'}\nr=c.query('test',on_permission=bare_allow); assert r.ok,r\nassert json.loads(r.text)=={'behavior':'allow','updatedInput':{'file_path':'/fixture'}}\nr=c.query('test',on_permission=lambda p:{'behavior':'allow','updatedInput':{'file_path':'/explicit'}}); assert r.ok,r\nassert json.loads(r.text)['updatedInput']=={'file_path':'/explicit'}\nr=c.query('test',on_permission=lambda p:{'behavior':'deny'}); assert r.ok,r\nassert json.loads(r.text)=={'behavior':'deny','message':'Permission denied by SDK caller'}\nprint('python permission defaults passed')`
  const result = spawnSync('python3', ['-c', code], { env: { ...process.env, PYTHONPATH: join(process.cwd(), 'sdk-python') }, encoding: 'utf8', timeout: 20_000 })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe('python permission defaults passed')
})

test('remote SDK authenticates and validates event revision/cursor, permission and reconnect contract', async () => {
  let approved = false
  const methods: string[] = []
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer fixture-token') { res.writeHead(401).end(); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const request = JSON.parse(raw); methods.push(request.method)
    const { method, params } = request
    let result: unknown = {}
    if (method === 'session/new') result = { sessionId: 'remote-session', workspaceRoot: '/fixture' }
    else if (method === 'session/resume') result = { sessionId: params.sessionId, workspaceRoot: '/fixture', lastSequence: 2 }
    else if (method === 'session/prompt') result = { sessionId: params.sessionId, runId: 'run-1' }
    else if (method === 'session/approve') { approved = params.decision.behavior === 'allow'; result = { accepted: approved } }
    else if (method === 'session/events') {
      if (params.sessionId === 'bad-sequence') result = { protocolVersion: 1, events: [{ protocolVersion: 1, sequence: 7, sessionId: params.sessionId, event: { type: 'result' } }], nextCursor: 7, done: true }
      else if (params.after === 0) result = { protocolVersion: 1, events: [{ protocolVersion: 1, sequence: 1, sessionId: params.sessionId, event: { type: 'permission', requestId: 'remote-approval', request: { options: [], toolCall: { rawInput: {} } } } }], nextCursor: 1, done: false }
      else if (!approved) { await new Promise(resolve => setTimeout(resolve, 10)); result = { protocolVersion: 1, events: [], nextCursor: params.after, done: false } }
      else result = { protocolVersion: 1, events: [{ protocolVersion: 1, sequence: 2, sessionId: params.sessionId, event: { type: 'result', stopReason: 'end_turn' } }], nextCursor: 2, done: true, result: { stopReason: 'end_turn' } }
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  try {
    const remote = new UrRemoteClient({ endpoint: `http://127.0.0.1:${address.port}/acp`, token: 'fixture-token' })
    const run = await remote.stream('test')
    for await (const envelope of run) if (envelope.event.type === 'permission') await run.approve(String(envelope.event.requestId), { behavior: 'allow' })
    expect((await run.result).ok).toBe(true)
    expect(run.lastSequence).toBe(2)
    const previousPrompts = methods.filter(method => method === 'session/prompt').length
    const resumed = await remote.resume('remote-session', 1)
    for await (const _ of resumed) {}
    expect((await resumed.result).ok).toBe(true)
    expect(methods.filter(method => method === 'session/prompt').length).toBe(previousPrompts)
    const bad = await remote.resume('bad-sequence', 0)
    for await (const _ of bad) {}
    expect((await bad.result).error).toContain('missing')
    await expect(new UrRemoteClient({ endpoint: `http://127.0.0.1:${address.port}`, token: 'wrong' }).initialize()).rejects.toThrow('401')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
