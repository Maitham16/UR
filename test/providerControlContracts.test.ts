import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '..')

// Real HTTP and the complete query/client dispatch path, isolated from user
// credentials and settings. The server rejects incorrect provider fields.
const fixture = String.raw`
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const source = path => pathToFileURL(join(process.env.UR_CONTROLS_ROOT, 'src', path)).href
const text = 'Hello from provider controls.'
let expected
const requests = []
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  if (req.method === 'GET') {
    const id = expected?.model ?? 'gpt-6.1-sol'
    const model = { id, name: 'models/' + id, display_name: id, supportedGenerationMethods: ['generateContent', 'streamGenerateContent'], ...(expected?.reasoning ? { reasoning: expected.reasoning } : {}) }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [model], models: [model] })); return
  }
  const body = JSON.parse(Buffer.concat(chunks).toString())
  requests.push({ url: req.url, body })
  try {
    assert.equal(req.headers['anthropic-beta'], undefined)
    if (expected.type === 'responses') {
      assert.ok(req.url.endsWith('/responses')); assert.equal(body.model, expected.model)
      assert.equal(body.service_tier, expected.tier); assert.equal(body.reasoning.effort, expected.effort)
      assert.equal(body.reasoning_effort, undefined); assert.equal(body.thinking, undefined)
      assert.equal(body.max_tokens, undefined); assert.equal(body.max_completion_tokens, undefined)
      assert.equal(body.max_output_tokens, 128); assert.equal(body.text?.verbosity, undefined)
    } else if (expected.type === 'gemini') {
      assert.ok(req.url.includes('/models/' + expected.model + ':'))
      assert.equal(body.service_tier, expected.tier)
      if (expected.budget !== undefined) {
        assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, expected.budget)
        assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, undefined)
      } else {
        assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, expected.effort)
        assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, undefined)
      }
      assert.equal(body.thinking, undefined); assert.equal(body.reasoning_effort, undefined)
    } else {
      assert.ok(req.url.endsWith('/chat/completions')); assert.equal(body.model, expected.model)
      if (expected.provider === 'openrouter') {
        if (expected.effort) assert.equal(body.reasoning.effort, expected.effort)
        if (expected.budget !== undefined) assert.equal(body.reasoning.max_tokens, expected.budget)
        if (expected.routing) assert.equal(body.provider.sort, expected.routing)
        assert.equal(body.reasoning_effort, undefined)
      } else {
        assert.equal(body.reasoning_effort, expected.effort)
        assert.equal(body.service_tier, expected.tier)
        assert.equal(body.thinking, undefined)
      }
      if (expected.provider === 'openai-api') { assert.equal(body.max_tokens, undefined); assert.equal(body.max_completion_tokens, 128) }
      if (expected.toggle !== undefined) assert.equal(body.chat_template_kwargs.enable_thinking, expected.toggle)
    }
  } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: String(error) } })); return }
  res.setHeader('Content-Type', 'application/json')
  if (expected.type === 'responses') {
    const response = { id: 'resp_controls', object: 'response', status: 'completed', model: body.model,
      output: [{ type: 'message', id: 'msg_controls', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], usage: { input_tokens: 4, output_tokens: 5 } }
    if (!body.stream) { res.end(JSON.stringify(response)); return }
    res.setHeader('Content-Type', 'text/event-stream')
    res.end([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_text.delta', item_id: 'msg_controls', output_index: 0, content_index: 0, delta: text },
      { type: 'response.completed', response },
    ].map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join('')); return
  }
  if (expected.type === 'gemini') {
    const response = { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 5 } }
    if (!req.url.includes('streamGenerateContent')) { res.end(JSON.stringify(response)); return }
    res.setHeader('Content-Type', 'text/event-stream'); res.end('data: ' + JSON.stringify(response) + '\n\n'); return
  }
  const response = { id: 'chatcmpl_controls', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 5 } }
  if (!body.stream) { res.end(JSON.stringify(response)); return }
  res.setHeader('Content-Type', 'text/event-stream')
  res.end('data: ' + JSON.stringify({ ...response, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'
process.chdir(process.env.UR_CONTROLS_DIR)
try {
  const { enableConfigs } = await import(source('utils/config.ts')); enableConfigs()
  const { resetSettingsCache } = await import(source('utils/settings/settingsCache.ts'))
  const { cacheProviderModelsForProvider, clearProviderModelCacheForTests } = await import(source('services/providers/providerRegistry.ts'))
  const { queryWithModel, queryModelWithStreaming } = await import(source('services/api/ur.ts'))
  const { asSystemPrompt } = await import(source('utils/systemPromptType.ts'))
  const { createUserMessage } = await import(source('utils/messages.ts'))
  const { getEmptyToolPermissionContext } = await import(source('Tool.ts'))
  const scenarios = [
    { provider: 'openai-api', model: 'gpt-6.1-sol', type: 'responses', tier: 'ultrafast', effort: 'xhigh' },
    { provider: 'openai-api', model: 'gpt-6-astra', type: 'responses', tier: 'fast', effort: 'max' },
    { provider: 'openai-api', model: 'gpt-6.1-terra', type: 'responses', tier: 'fast', effort: 'none' },
    { provider: 'openai-api', model: 'gpt-6.1-terra', type: 'responses', tier: 'flex', effort: 'high' },
    { provider: 'openai-api', model: 'gpt-5.6-sol', type: 'chat', tier: 'fast', effort: 'none' },
    { provider: 'openai-api', model: 'gpt-6-luna', type: 'responses', tier: 'flex', effort: 'low' },
    { provider: 'openai-api', model: 'gpt-5.5', type: 'chat', tier: 'fast', effort: 'none' },
    { provider: 'openai-api', model: 'gpt-5.4', type: 'chat', tier: 'fast', effort: 'none' },
    { provider: 'openai-api', model: 'gpt-5.5-pro', type: 'responses', tier: 'flex', effort: 'xhigh' },
    { provider: 'gemini-api', model: 'gemini-3.8-flash', type: 'gemini', tier: 'priority', effort: 'low' },
    { provider: 'gemini-api', model: 'gemini-3.6-flash', type: 'gemini', tier: 'flex', effort: 'minimal' },
    { provider: 'gemini-api', model: 'gemini-2.5-pro', type: 'gemini', budget: 8192 },
    { provider: 'gemini-api', model: 'gemini-2.5-flash', type: 'gemini', budget: 0 },
    { provider: 'nvidia-nim', model: 'nvidia/nemotron-3-ultra-550b-a55b', type: 'chat', effort: 'medium' },
    { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-pro-0813', type: 'chat', effort: 'none' },
    { provider: 'nvidia-nim', model: 'google/gemma-4-31b-it', type: 'chat', toggle: false },
    { provider: 'openrouter', model: 'moonshotai/kimi-k3', type: 'chat', effort: 'none', routing: 'latency', reasoning: { supportedEfforts: ['none', 'low', 'high', 'max'], defaultEffort: 'max', mandatory: false } },
    { provider: 'vllm', model: 'custom-native-level', type: 'chat', effort: 'Deep', reasoning: { supportsThinking: true, supportedEfforts: ['Brief', 'Deep'], defaultEffort: 'Deep' } },
    { provider: 'openrouter', model: 'fixture-budget-only', type: 'chat', budget: 4096, reasoning: { supportsThinking: true, supportsMaxTokens: true, mandatory: false } },
  ]
  for (const scenario of scenarios) {
    expected = scenario
    const provider = { active: scenario.provider, model: scenario.model, baseUrls: { [scenario.provider]: baseUrl },
      ...(scenario.provider === 'openai-api' ? { openai: { serviceTier: scenario.tier } } : {}),
      ...(scenario.provider === 'gemini-api' ? { gemini: { serviceTier: scenario.tier } } : {}),
      ...(scenario.routing ? { openrouter: { routing: scenario.routing } } : {}),
      ...(scenario.budget !== undefined ? { thinkingBudgets: { [scenario.provider]: { [scenario.model]: scenario.budget } } } : {}) }
    writeFileSync(join(process.env.UR_CONFIG_DIR, 'settings.json'), JSON.stringify({ provider }))
    resetSettingsCache(); clearProviderModelCacheForTests()
    if (scenario.reasoning && scenario.provider === 'openrouter') cacheProviderModelsForProvider(scenario.provider, [{ id: scenario.model, displayName: scenario.model, description: 'fixture', reasoning: scenario.reasoning }])
    const options = { model: scenario.model, providerSettings: provider, isNonInteractiveSession: true, querySource: 'repl_main_thread',
      agents: [], hasAppendSystemPrompt: false, mcpTools: [], maxOutputTokensOverride: 128, enablePromptCaching: false, effortValue: scenario.effort }
    const answer = await queryWithModel({ systemPrompt: asSystemPrompt(['Be brief.']), userPrompt: 'hi', signal: AbortSignal.timeout(15000), options })
    assert.ok(answer.message.content.some(block => block.type === 'text' && block.text.includes(text)), JSON.stringify(answer.message.content))
    if (['gpt-6.1-sol', 'gpt-6.1-terra', 'gemini-3.8-flash'].includes(scenario.model)) {
      let found = false
      for await (const event of queryModelWithStreaming({ messages: [createUserMessage({ content: 'hi' })], systemPrompt: asSystemPrompt(['Be brief.']),
        thinkingConfig: { type: 'disabled' }, tools: [], signal: AbortSignal.timeout(15000), options: { ...options, getToolPermissionContext: async () => getEmptyToolPermissionContext() } })) {
        if (event.type === 'assistant') found = event.message.content.some(block => block.type === 'text' && block.text.includes(text))
      }
      assert.equal(found, true)
    }
  }
  writeFileSync(process.env.UR_CONTROLS_REPORT, JSON.stringify({ passed: true, scenarios: scenarios.length, requests: requests.length }))
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
`

test('provider controls use valid native requests through the full query and streaming pipelines', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'ur-provider-contract-'))), config = join(work, 'config'), workspace = join(work, 'workspace')
  mkdirSync(config); mkdirSync(workspace)
  const script = join(work, 'fixture.ts'), report = join(work, 'report.json'); writeFileSync(script, fixture)
  try {
    const result = spawnSync(process.execPath, ['run', '--preload', join(root, 'plugins/bunBundleDev.ts'), script], { cwd: root,
      encoding: 'utf8', timeout: 90_000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', SHELL: '/bin/sh', UR_CONFIG_DIR: config, UR_CONTROLS_ROOT: root,
        UR_CONTROLS_DIR: workspace, UR_CONTROLS_REPORT: report, OPENAI_API_KEY: 'fixture-key',
        GEMINI_API_KEY: 'fixture-key', NVIDIA_API_KEY: 'fixture-key', OPENROUTER_API_KEY: 'fixture-key',
        UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', UR_CODE_DISABLE_AUTO_MEMORY: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', CI: '1', NODE_ENV: 'production' } })
    expect(result.error, result.stderr).toBeUndefined(); expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({ passed: true, scenarios: 19, requests: 23 })
  } finally { rmSync(work, { recursive: true, force: true }) }
}, 120_000)
