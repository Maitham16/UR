#!/usr/bin/env node
// Real native HTTP worker, approval, durable replay and container replacement.
// Only model responses are controlled; the CLI, tools and persistence are real.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const index = process.argv.indexOf('--native-dir')
if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: node scripts/acp-container-smoke.mjs --native-dir <extracted Linux release>')
const native = resolve(process.argv[index + 1])
const manifest = JSON.parse(readFileSync(join(native, 'resources/manifest.json'), 'utf8'))
if (!/^linux-(arm64|x64)$/.test(manifest.platform)) throw new Error('A native Linux payload is required')
const platform = manifest.platform.endsWith('arm64') ? 'linux/arm64' : 'linux/amd64'
const docker = process.env.DOCKER_BIN || 'docker'
const temp = mkdtempSync(join(tmpdir(), 'ur-acp-container-'))
const suffix = randomBytes(6).toString('hex'), name = `ur-acp-${suffix}`, tag = `${name}:smoke`
const workspaceVolume = `${name}-workspace`, stateVolume = `${name}-state`
const token = randomBytes(32).toString('hex')
const logs = []
let endpoint, completions = 0, success = false
const run = (args, options = {}) => execFileSync(docker, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options }).trim()
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms))
async function until(fn, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await pause(150) }
  throw new Error('Container integration timed out')
}
async function rpc(method, params = {}, credential = token, expectedStatus = 200) {
  const response = await fetch(`${endpoint}/acp`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000),
  })
  assert.equal(response.status, expectedStatus)
  const body = await response.json()
  if (expectedStatus === 200) { assert.equal(body.error, undefined, JSON.stringify(body.error)); return body.result }
  return body
}
const provider = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && ['/v1/models', '/models'].includes(request.url)) {
      response.setHeader('content-type', 'application/json')
      return response.end(JSON.stringify({ object: 'list', data: [{ id: 'remote-fixture', object: 'model', context_length: 32768, supported_parameters: ['tools', 'max_tokens'] }] }))
    }
    assert.equal(request.url, '/v1/chat/completions')
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    completions++
    const toolDone = body.messages.some(message => message.role === 'tool')
    const resumed = body.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('SECOND_PROMPT'))
    if (!toolDone && !resumed) assert.ok(body.tools.some(tool => tool.function?.name === 'Write'))
    const message = toolDone || resumed
      ? { role: 'assistant', content: resumed ? 'RESUMED_OK' : 'APPROVED_WRITE_OK' }
      : { role: 'assistant', content: null, tool_calls: [{ id: 'remote-write', type: 'function', function: { name: 'Write', arguments: JSON.stringify({ file_path: '/workspace/proof.txt', content: 'remote native approval proof\n' }) } }] }
    const finish = message.tool_calls ? 'tool_calls' : 'stop'
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    if (body.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const delta = message.tool_calls ? { ...message, tool_calls: message.tool_calls.map((call, i) => ({ ...call, index: i })) } : message
      response.write(`data: ${JSON.stringify({ id: 'remote-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: 'remote-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage })}\n\n`)
      response.end('data: [DONE]\n\n')
    } else {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ id: 'remote-fixture', object: 'chat.completion', model: body.model, choices: [{ index: 0, message, finish_reason: finish }], usage }))
    }
  } catch (error) { logs.push(String(error)); response.writeHead(500); response.end(JSON.stringify({ error: { message: String(error) } })) }
})
async function start() {
  run(['run', '-d', '--name', name, '--platform', platform, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--tmpfs', '/tmp:rw,nosuid,size=128m', '--mount', `type=volume,src=${workspaceVolume},dst=/workspace`,
    '--mount', `type=volume,src=${stateVolume},dst=/state`, '--add-host', 'host.docker.internal:host-gateway',
    '--env-file', join(temp, 'runtime.env'), '-p', '127.0.0.1::8123', tag])
  const port = run(['port', name, '8123/tcp']).split(':').at(-1)
  endpoint = `http://127.0.0.1:${port}`
  await until(async () => { try { return (await fetch(`${endpoint}/healthz`, { signal: AbortSignal.timeout(1000) })).ok } catch { return false } })
}
try {
  await new Promise((resolveListen, reject) => { provider.once('error', reject); provider.listen(0, '0.0.0.0', resolveListen) })
  const config = join(temp, 'config'); mkdirSync(config)
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ provider: { active: 'openai-compatible', model: 'remote-fixture', baseUrls: { 'openai-compatible': `http://host.docker.internal:${provider.address().port}/v1` } }, sandbox: { enabled: false } }))
  writeFileSync(join(temp, 'runtime.env'), `UR_ACP_TOKEN=${token}\nUR_MODEL=remote-fixture\nOPENAI_COMPATIBLE_API_KEY=ur-container-fixture-no-secret\nUR_ACP_STDIO_PROMPT_TIMEOUT_MS=60000\n`, { mode: 0o600 })
  // Context contains the exact payload and this Dockerfile, never repository secrets.
  const context = join(temp, 'context'); mkdirSync(context)
  cpSync(join(native, 'ur'), join(context, 'ur'))
  cpSync(join(native, 'resources'), join(context, 'resources'), { recursive: true })
  cpSync(join(root, 'deployment/acp/Dockerfile'), join(context, 'Dockerfile'))
  run(['build', '--platform', platform, '-t', tag, context], { timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] })
  run(['volume', 'create', workspaceVolume]); run(['volume', 'create', stateVolume])
  run(['run', '--rm', '--platform', platform, '--user', '0:0', '--entrypoint', '/bin/sh',
    '--mount', `type=volume,src=${stateVolume},dst=/state`, '--mount', `type=bind,src=${config},dst=/seed,readonly`,
    tag, '-c', 'cp /seed/settings.json /state/config/settings.json && chown -R 10001:10001 /state && chmod 700 /state/config && chmod 600 /state/config/settings.json'])
  await start()
  assert.equal(run(['exec', name, 'id', '-u']), '10001')
  assert.equal(run(['exec', name, 'sh', '-c', 'test ! -w /opt/ur/ur && ! command -v node && ! command -v bun && echo RUNTIME_OK']), 'RUNTIME_OK')
  await rpc('initialize', {}, 'invalid', 401)
  const { sessionId } = await rpc('session/new', { cwd: '/workspace' })
  const request = { sessionId, prompt: 'Write proof.txt with the requested proof.', requestId: 'write-once', stream: true }
  const first = await rpc('session/prompt', request)
  assert.equal((await rpc('session/prompt', request)).runId, first.runId)
  const permission = await until(async () => {
    const page = await rpc('session/events', { sessionId })
    const pending = page.events.find(event => event.event.type === 'permission')
    if (!pending && page.done) throw new Error(`Native prompt ended before approval: ${JSON.stringify(page)}`)
    return pending
  })
  assert.equal(run(['exec', name, 'sh', '-c', 'test ! -e /workspace/proof.txt && echo PENDING']), 'PENDING')
  await rpc('session/approve', { sessionId, requestId: permission.event.requestId, decision: { behavior: 'allow' } })
  const done = await until(async () => { const page = await rpc('session/events', { sessionId }); return page.done ? page : undefined })
  assert.equal(done.result?.stopReason, 'end_turn', JSON.stringify(done))
  assert.equal(run(['exec', name, 'cat', '/workspace/proof.txt']), 'remote native approval proof')
  assert.deepEqual(done.events.map(event => event.sequence), done.events.map((_, i) => i + 1))
  const paired = await rpc('device/new', { sessionIds: [sessionId], expiresInMs: 60000 })
  await rpc('session/events', { sessionId }, paired.token)
  await rpc('device/revoke', { deviceId: paired.deviceId })
  await rpc('session/events', { sessionId }, paired.token, 401)
  const before = completions
  logs.push(run(['logs', name]))
  run(['stop', '--time', '10', name]); run(['rm', name])
  await start()
  assert.equal((await rpc('session/resume', { sessionId })).lastSequence, done.nextCursor)
  assert.deepEqual((await rpc('session/events', { sessionId })).events, done.events)
  assert.equal(completions, before, 'Reconnection must not rerun the prompt')
  await rpc('session/events', { sessionId }, paired.token, 401)
  await rpc('session/prompt', { sessionId, prompt: 'SECOND_PROMPT: acknowledge the prior work.', requestId: 'second', stream: true })
  const resumed = await until(async () => { const page = await rpc('session/events', { sessionId, after: done.nextCursor }); return page.done ? page : undefined })
  assert.equal(resumed.result?.stopReason, 'end_turn', JSON.stringify(resumed))
  assert.ok(JSON.stringify(resumed.events).includes('RESUMED_OK'))
  assert.equal(run(['exec', name, 'cat', '/workspace/proof.txt']), 'remote native approval proof')
  success = true
  console.log(JSON.stringify({ passed: true, platform, version: manifest.version, completions, checks: ['nonroot', 'readonly-application', 'no-external-runtime', 'authentication', 'native-tool-approval', 'idempotency', 'scoped-device-revocation', 'replacement-container-replay', 'native-session-resume'] }))
} catch (error) {
  console.error(error)
  if (error.stderr) logs.push(String(error.stderr))
  process.exitCode = 1
} finally {
  try { logs.push(run(['logs', name])) } catch {}
  writeFileSync(join(temp, 'diagnostics.log'), logs.join('\n').replaceAll(token, '[redacted]'))
  for (const args of [['rm', '-f', name], ['volume', 'rm', workspaceVolume, stateVolume], ['image', 'rm', tag]]) {
    try { run(args, { stdio: 'ignore' }) } catch {}
  }
  provider.closeAllConnections(); await new Promise(resolveClose => provider.close(resolveClose))
  // Retain failure diagnostics but remove ephemeral credentials and copied binaries.
  rmSync(join(temp, 'runtime.env'), { force: true }); rmSync(join(temp, 'context'), { recursive: true, force: true })
  if (success) rmSync(temp, { recursive: true, force: true })
  else console.error(`Container evidence: ${temp}`)
}
