import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')

// Isolate provider/settings/module state in a child, and exercise the real
// query builder against an HTTP server that rejects unsupported beta headers.
const fixture = String.raw`
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = process.env.UR_CONTRACT_ROOT!
const directory = process.env.UR_CONTRACT_DIR!
const source = path => pathToFileURL(join(root, 'src', path)).href
const requests = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-4-5'].map(id => ({ id, type: 'model', display_name: id })) }))
    return
  }
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const betas = String(req.headers['anthropic-beta'] ?? '').split(',').filter(Boolean)
  requests.push({ path: req.url, body, betas })
  const allowed = ['context-1m-2025-08-07', 'interleaved-thinking-2025-05-14', 'fast-mode-2026-02-01']
  const invalid = betas.filter(beta => !allowed.includes(beta))
  if (invalid.length || (body.model === 'claude-opus-5-5' && body.temperature !== undefined)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid public API request: ' + invalid.join(',') } }))
    return
  }
  res.setHeader('Content-Type', 'application/json')
  if (req.url?.endsWith('/count_tokens')) {
    res.end(JSON.stringify({ input_tokens: 17 }))
    return
  }
  const message = { id: 'msg_contract', type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: 'Hello from the contract fixture.' }], stop_reason: 'end_turn',
    stop_sequence: null, usage: { input_tokens: 10, output_tokens: 3 } }
  if (!body.stream) { res.end(JSON.stringify(message)); return }
  res.setHeader('Content-Type', 'text/event-stream')
  const events = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: message.content[0].text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]
  res.end(events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join(''))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'
const provider = { active: 'anthropic-api', model: 'claude-opus-5-5', baseUrls: { 'anthropic-api': baseUrl } }
writeFileSync(join(process.env.UR_CONFIG_DIR!, 'settings.json'), JSON.stringify({ provider }))
process.chdir(directory)
try {
  const { enableConfigs } = await import(source('utils/config.ts'))
  enableConfigs()
  const { queryWithModel, queryModelWithStreaming } = await import(source('services/api/ur.ts'))
  const { createStandardAPIClient } = await import(source('services/api/standardAPI.ts'))
  const { getMergedBetas, shouldIncludeFirstPartyOnlyBetas } = await import(source('utils/betas.ts'))
  const { asSystemPrompt } = await import(source('utils/systemPromptType.ts'))
  const { createUserMessage } = await import(source('utils/messages.ts'))
  const { getEmptyToolPermissionContext } = await import(source('Tool.ts'))
  const options = { model: 'claude-opus-5-5', providerSettings: provider, isNonInteractiveSession: true,
    querySource: 'repl_main_thread', agents: [], hasAppendSystemPrompt: false, mcpTools: [],
    maxOutputTokensOverride: 128, enablePromptCaching: false, effortValue: 'high' }
  assert.equal(shouldIncludeFirstPartyOnlyBetas(), false)
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
    assert.deepEqual(getMergedBetas(model, { isAgenticQuery: true }), [])
    const answer = await queryWithModel({ systemPrompt: asSystemPrompt(['Be brief.']), userPrompt: 'hi',
      signal: AbortSignal.timeout(15000), options: { ...options, model } })
    assert.ok(answer.message.content.some(block => block.type === 'text' && block.text.includes('Hello')), JSON.stringify(answer.message.content))
  }
  const stream = queryModelWithStreaming({ messages: [createUserMessage({ content: 'hi' })],
    systemPrompt: asSystemPrompt(['Be brief.']), thinkingConfig: { type: 'disabled' }, tools: [],
    signal: AbortSignal.timeout(15000), options: { ...options, getToolPermissionContext: async () => getEmptyToolPermissionContext() } })
  let streamedAnswer = false
  for await (const event of stream) {
    if (event.type === 'assistant') streamedAnswer = event.message.content.some(block => block.type === 'text' && block.text.includes('Hello'))
  }
  assert.equal(streamedAnswer, true)
  assert.ok(requests.length >= 4)
  assert.ok(requests.every(request => request.betas.length === 0))
  assert.ok(requests.filter(request => request.body.model === 'claude-opus-5-5').every(request => request.body.temperature === undefined))
  const normalRequests = requests.length
  process.env.URHQ_BETAS = 'context-1m-2025-08-07, context-1m-2025-08-07'
  assert.deepEqual(getMergedBetas('claude-opus-5-5'), ['context-1m-2025-08-07'])
  delete process.env.URHQ_BETAS
  assert.deepEqual(getMergedBetas('claude-opus-5-5'), [])
  const client = await createStandardAPIClient({ providerId: 'anthropic-api', baseUrl, apiKey: 'fixture-key', maxRetries: 0 })
  const params = { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], max_tokens: 32 }
  assert.deepEqual(await client.beta.messages.countTokens({ ...params, betas: getMergedBetas(params.model) }), { input_tokens: 17, source: 'provider' })
  await client.beta.messages.create({ ...params, betas: ['context-1m-2025-08-07', 'context-1m-2025-08-07'] })
  assert.deepEqual(requests.at(-1).betas, ['context-1m-2025-08-07'])
  const tools = [{ name: 'lookup', input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } }]
  await client.beta.messages.create({ ...params, model: 'claude-opus-4-5', tools, thinking: { type: 'enabled', budget_tokens: 1024 } })
  assert.deepEqual(requests.at(-1).betas, ['interleaved-thinking-2025-05-14'])
  await client.beta.messages.create({ ...params, tools, thinking: { type: 'adaptive' } })
  assert.deepEqual(requests.at(-1).betas, [])
  const fast = await createStandardAPIClient({ providerId: 'anthropic-api', baseUrl, apiKey: 'fixture-key', maxRetries: 0, anthropic: { speed: 'fast' } })
  await fast.beta.messages.create(params)
  assert.deepEqual(requests.at(-1).betas, ['fast-mode-2026-02-01'])
  writeFileSync(process.env.UR_CONTRACT_REPORT!, JSON.stringify({ normalRequests, totalRequests: requests.length, passed: true }))
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
`

test('public Claude requests reject legacy headers through the complete query pipeline', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'ur-anthropic-contract-')))
  const config = join(work, 'config'), workspace = join(work, 'workspace')
  mkdirSync(config); mkdirSync(workspace)
  const script = join(work, 'fixture.ts'), report = join(work, 'report.json')
  writeFileSync(script, fixture)
  try {
    const result = spawnSync(process.execPath, ['run', '--preload', join(root, 'plugins/bunBundleDev.ts'), script], {
      cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', SHELL: '/bin/sh', UR_CONFIG_DIR: config,
        UR_CONTRACT_ROOT: root, UR_CONTRACT_DIR: workspace, UR_CONTRACT_REPORT: report,
        ANTHROPIC_API_KEY: 'fixture-key', UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        UR_CODE_DISABLE_AUTO_MEMORY: '1', UR_CODE_DISABLE_FAST_MODE: '1',
        DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', CI: '1', NODE_ENV: 'production' },
    })
    expect(result.error, result.stderr).toBeUndefined()
    expect(result.status, result.stderr || result.stdout).toBe(0)
    const evidence = JSON.parse(readFileSync(report, 'utf8'))
    expect(evidence.passed).toBe(true)
    expect(evidence.normalRequests).toBeGreaterThanOrEqual(4)
    expect(evidence.totalRequests).toBeGreaterThanOrEqual(9)
  } finally { rmSync(work, { recursive: true, force: true }) }
}, 120_000)
