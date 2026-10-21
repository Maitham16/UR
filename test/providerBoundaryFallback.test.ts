import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')

// The transport replacement lives only in a child process. Production client
// selection, stream parsing, fallback request capping, and boundary emission
// run unchanged, and every transport call must use the fixture origin.
const fixture = String.raw`
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = process.env.UR_BOUNDARY_SOURCE_ROOT!
const reason = process.env.UR_BOUNDARY_STOP_REASON!
process.chdir(process.env.UR_BOUNDARY_WORKSPACE!)
const source = path => pathToFileURL(join(root, 'src', path)).href
const { default: axios } = await import(pathToFileURL(join(root, 'node_modules/axios/index.js')).href)
const requests = []
const unexpectedFetches = []
globalThis.fetch = async (input, init) => {
  const endpoint = new URL(String(input))
  if (endpoint.origin === 'https://boundary-fallback.invalid' &&
      endpoint.pathname === '/v1/models' && (init?.method ?? 'GET') === 'GET') {
    return Response.json({ data: [{ id: 'claude-sonnet-5', type: 'model', display_name: 'Fixture Claude' }], has_more: false })
  }
  unexpectedFetches.push(String(input))
  throw new Error('Unexpected fetch outside the isolated boundary fixture')
}
axios.post = async (url, body) => {
  const endpoint = new URL(String(url))
  assert.equal(endpoint.origin, 'https://boundary-fallback.invalid')
  assert.equal(endpoint.pathname, '/v1/messages')
  requests.push(structuredClone(body))
  assert.ok(requests.length <= 2, 'fallback must not start another provider attempt')
  if (body.stream) {
    assert.equal(requests.length, 1)
    return {
      headers: { 'request-id': 'fixture-stream-request' }, status: 200,
      data: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('data: ' + JSON.stringify({
            type: 'message_start', message: {
              id: 'fixture-stream', model: body.model, role: 'assistant', type: 'message', content: [],
              stop_reason: null, stop_sequence: null,
              usage: { input_tokens: 100, output_tokens: 0 },
            },
          }) + '\n\n')
          throw new Error('Deterministic fixture stream transport failure')
        },
      },
    }
  }
  assert.equal(requests.length, 2)
  return {
    headers: { 'request-id': 'fixture-buffered-request' }, status: 200,
    data: {
      id: 'fixture-buffered', model: body.model, role: 'assistant', type: 'message',
      content: [{ type: 'text', text: 'Buffered partial work that must survive recovery.' }],
      stop_reason: reason, stop_sequence: null,
      usage: { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens: body.max_tokens },
    },
  }
}
const { queryModelWithStreaming, MAX_NON_STREAMING_TOKENS } = await import(source('services/api/ur.ts'))
const { createUserMessage } = await import(source('utils/messages.ts'))
const { isPromptTooLongMessage } = await import(source('services/api/errors.ts'))
const { asSystemPrompt } = await import(source('utils/systemPromptType.ts'))
const { getEmptyToolPermissionContext } = await import(source('Tool.ts'))
const { enableConfigs } = await import(source('utils/config.ts'))
enableConfigs()
const provider = {
  active: 'anthropic-api', model: 'claude-sonnet-5',
  baseUrls: { 'anthropic-api': 'https://boundary-fallback.invalid' },
}
let fallbacks = 0
const yielded = []
for await (const message of queryModelWithStreaming({
  messages: [createUserMessage({ content: 'Continue the fixture task.' })],
  systemPrompt: asSystemPrompt(['Answer only the fixture task.']),
  thinkingConfig: { type: 'disabled' }, tools: [], signal: new AbortController().signal,
  options: {
    getToolPermissionContext: async () => getEmptyToolPermissionContext(),
    model: provider.model, providerSettings: provider,
    maxOutputTokensOverride: MAX_NON_STREAMING_TOKENS + 16000,
    isNonInteractiveSession: true, querySource: 'sdk', agents: [],
    hasAppendSystemPrompt: false, mcpTools: [], enablePromptCaching: false,
    onStreamingFallback: () => { fallbacks++ },
  },
})) yielded.push(message)
const errors = yielded.filter(message => message.type === 'assistant' && message.isApiErrorMessage)
const partials = yielded.filter(message => message.type === 'assistant' && !message.isApiErrorMessage)
writeFileSync(process.env.UR_BOUNDARY_REPORT!, JSON.stringify({
  requests, fallbacks, errors, partials, maxNonStreamingTokens: MAX_NON_STREAMING_TOKENS,
  promptTooLong: errors.map(isPromptTooLongMessage), unexpectedFetches,
}))
`

function runFallback(stopReason: string) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'ur provider boundary ')))
  const workspace = join(work, 'workspace'), config = join(work, 'home', '.ur')
  mkdirSync(workspace)
  mkdirSync(config, { recursive: true })
  const script = join(work, 'fixture.ts'), report = join(work, 'report.json')
  writeFileSync(script, fixture)
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ provider: {
    active: 'anthropic-api', model: 'claude-sonnet-5',
    baseUrls: { 'anthropic-api': 'https://boundary-fallback.invalid' },
  } }))
  try {
    const child = spawnSync(process.execPath, ['run', '--preload', join(root, 'plugins/bunBundleDev.ts'), script], {
      cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      env: {
        PATH: '/usr/bin:/bin', HOME: join(work, 'home'), USERPROFILE: join(work, 'home'), SHELL: '/bin/sh',
        UR_CONFIG_DIR: config, UR_BOUNDARY_SOURCE_ROOT: root, UR_BOUNDARY_REPORT: report,
        UR_BOUNDARY_WORKSPACE: workspace,
        UR_BOUNDARY_STOP_REASON: stopReason, ANTHROPIC_API_KEY: 'fixture-no-secret',
        UR_CODE_SIMPLE: '1', UR_CODE_DISABLE_AUTO_MEMORY: '1', UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        UR_CODE_DISABLE_FAST_MODE: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DO_NOT_TRACK: '1',
        // Exercise dispatch itself rather than replaying a test-mode VCR file.
        CI: '1', NODE_ENV: 'production', USER_TYPE: 'external',
      },
    })
    expect(child.error, child.stderr).toBeUndefined()
    expect(child.status, child.stderr || child.stdout).toBe(0)
    return JSON.parse(readFileSync(report, 'utf8'))
  } finally { rmSync(work, { recursive: true, force: true }) }
}

describe('actual buffered fallback response boundaries', () => {
  for (const stopReason of ['max_tokens', 'model_context_window_exceeded']) {
    test(`stream failure followed by ${stopReason} preserves partial work and its recovery classification`, () => {
      const report = runFallback(stopReason)
      expect(report.requests, JSON.stringify(report.errors)).toHaveLength(2)
      expect(report.requests[0].stream).toBe(true)
      expect(report.requests[0].max_tokens).toBe(report.maxNonStreamingTokens + 16000)
      expect(report.requests[1].stream).not.toBe(true)
      expect(report.requests[1].max_tokens).toBe(report.maxNonStreamingTokens)
      expect(report.fallbacks).toBe(1)
      expect(report.unexpectedFetches).toEqual([])
      expect(report.partials).toHaveLength(1)
      expect(report.partials[0].message.content).toEqual([{ type: 'text', text: 'Buffered partial work that must survive recovery.' }])
      expect(report.partials[0].message.stop_reason).toBe(stopReason)
      expect(report.errors).toHaveLength(1)
      if (stopReason === 'max_tokens') {
        expect(report.errors[0]).toMatchObject({
          apiError: 'max_output_tokens', error: 'max_output_tokens',
          outputLimit: { requestedMaxTokens: report.maxNonStreamingTokens, inputTokens: 600, outputTokens: report.maxNonStreamingTokens },
        })
        expect(report.promptTooLong).toEqual([false])
      } else {
        expect(report.errors[0]).toMatchObject({ apiError: 'prompt_too_long', error: 'invalid_request' })
        expect(report.errors[0].outputLimit).toBeUndefined()
        expect(report.promptTooLong).toEqual([true])
      }
    }, 120_000)
  }
})
