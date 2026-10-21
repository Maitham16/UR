import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
type Chunk = {
  text?: string; thinking?: string; opaque?: string; capped?: boolean; tool?: boolean; promptTooLong?: boolean
  fallbackOrphanText?: string
  outputLimit?: { requestedMaxTokens: number; inputTokens?: number; outputTokens?: number }
}
type Scenario = { chunks: Chunk[]; initialBudget?: number; ceiling?: number; compactOnce?: boolean }
type Request = { messages: any[]; maxOutputTokensOverride?: number; model: string }
type Report = {
  requests: Request[]; yielded: any[]; terminal: { reason: string }; toolCalls: number
  compactions: { reason: string; messages: any[]; forkMessages: any[] }[]
}

// All process state and module loading are confined to a child. The real query
// generator runs unchanged; its supported deps seam captures actual model calls.
const fixture = String.raw`
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
const root = process.env.UR_QUERY_SOURCE_ROOT!
const workspace = process.env.UR_QUERY_FIXTURE_DIR!
process.chdir(workspace)
const scenario = JSON.parse(readFileSync(process.env.UR_QUERY_SCENARIO!, 'utf8'))
const source = path => pathToFileURL(join(root, 'src', path)).href
const { query } = await import(source('query.ts'))
const { getDefaultAppState } = await import(source('state/AppStateStore.ts'))
const { createAssistantMessage, createAssistantAPIErrorMessage, createUserMessage, createCompactBoundaryMessage } = await import(source('utils/messages.ts'))
const { asSystemPrompt } = await import(source('utils/systemPromptType.ts'))
const { z } = createRequire(join(root, 'package.json'))('zod/v4')
const provider = { active: 'openai-compatible', model: 'continuation-fixture', baseUrls: { 'openai-compatible': 'http://127.0.0.1:1/v1' } }
const appState = getDefaultAppState()
appState.provider = provider
const requests = [], yielded = [], compactions = []
let toolCalls = 0, emergencyCompactions = 0
const tool = {
  name: 'ContinuationProbe', inputSchema: z.object({}), outputSchema: z.string(),
  description: async () => 'Record deterministic read-only progress.',
  prompt: async () => 'Record deterministic read-only progress.',
  userFacingName: () => 'ContinuationProbe', isEnabled: () => true,
  isReadOnly: () => true, isConcurrencySafe: () => true,
  requiresUserInteraction: () => false,
  checkPermissions: async input => ({ behavior: 'allow', updatedInput: input }),
  call: async () => { toolCalls++; return { data: 'phase advanced' } },
  mapToolResultToToolResultBlockParam: (data, id) => ({ type: 'tool_result', tool_use_id: id, content: String(data) }),
}
const context = {
  agentId: 'output-limit-fixture', agentType: 'output-limit-fixture',
  abortController: new AbortController(),
  options: {
    commands: [], tools: scenario.chunks.some(chunk => chunk.tool) ? [tool] : [],
    mainLoopModel: 'continuation-fixture', thinkingConfig: { type: 'enabled', budgetTokens: 1024 },
    mcpClients: [], mcpResources: {}, isNonInteractiveSession: true,
    debug: false, verbose: false, cwd: workspace,
    agentDefinitions: { activeAgents: [], allAgents: [] },
  },
  getAppState: () => appState, setAppState: () => {}, messages: [],
  readFileState: new Map(), setInProgressToolUseIDs: () => {},
  setResponseLength: () => {}, updateFileHistoryState: () => {},
  updateAttributionState: () => {}, appendSystemMessage: () => {},
  addNotification: () => {},
}
const deps = {
  uuid: randomUUID,
  microcompact: async messages => ({ messages }),
  autocompact: async (...args) => {
    compactions.push(JSON.parse(JSON.stringify({ reason: args[6] ?? 'proactive', messages: args[0], forkMessages: args[2].forkContextMessages })))
    if (args[6] === 'context_limit' && scenario.compactOnce && emergencyCompactions++ === 0) return {
      compactionResult: {
        boundaryMarker: createCompactBoundaryMessage('auto', 1000),
        summaryMessages: [createUserMessage({ content: 'COMPACTED_CONTEXT_FIXTURE: continue the remaining answer.', isMeta: true })],
        attachments: [], hookResults: [],
      }, consecutiveFailures: 0,
    }
    return { compactionResult: undefined, consecutiveFailures: 0 }
  },
  async *callModel(request) {
    const index = requests.length
    requests.push(JSON.parse(JSON.stringify({ messages: request.messages, model: request.options.model, maxOutputTokensOverride: request.options.maxOutputTokensOverride })))
    const chunk = scenario.chunks[index]
    if (!chunk) throw new Error('Unexpected query model request ' + (index + 1))
    if (chunk.fallbackOrphanText !== undefined) {
      yield createAssistantMessage({ content: [{ type: 'text', text: chunk.fallbackOrphanText }] })
      request.options.onStreamingFallback()
    }
    const content = []
    if (chunk.thinking !== undefined) content.push({ type: 'thinking', thinking: chunk.thinking, signature: 'fixture-signature-' + index })
    if (chunk.opaque !== undefined) content.push({ type: 'redacted_thinking', data: chunk.opaque })
    if (chunk.text !== undefined) content.push({ type: 'text', text: chunk.text })
    if (chunk.tool) content.push({ type: 'tool_use', id: 'continuation-tool-' + index, name: tool.name, input: {} })
    if (content.length) {
      const message = createAssistantMessage({ content, usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
      message.message.model = request.options.model
      message.message.stop_reason = chunk.capped ? 'max_tokens' : chunk.tool ? 'tool_use' : 'end_turn'
      yield message
    }
    if (chunk.capped) {
      const diagnostic = createAssistantAPIErrorMessage({
        content: 'SYNTHETIC_OUTPUT_LIMIT_DIAGNOSTIC_' + index,
        apiError: 'max_output_tokens', error: 'max_output_tokens',
      })
      if (chunk.outputLimit) diagnostic.outputLimit = chunk.outputLimit
      yield diagnostic
    }
    if (chunk.promptTooLong) yield createAssistantAPIErrorMessage({
      content: 'Prompt is too long: CONTEXT_LIMIT_FIXTURE', error: 'invalid_request',
    })
  },
}
const stream = query({
  messages: [createUserMessage({ content: 'Explain the supplied fixture in consecutive sections without changing files.' })],
  systemPrompt: asSystemPrompt(['Answer the fixture request.']), userContext: {}, systemContext: {},
  canUseTool: async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
  toolUseContext: context, querySource: 'agent:output-limit-fixture',
  maxOutputTokensOverride: scenario.initialBudget ?? 4096, deps,
})
let terminal
for (;;) {
  const next = await stream.next()
  if (next.done) { terminal = next.value; break }
  yielded.push(next.value)
}
writeFileSync(process.env.UR_QUERY_REPORT!, JSON.stringify({ requests, yielded, terminal, toolCalls, compactions }))
`

function runScenario(scenario: Scenario): Report {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'ur output continuation ')))
  const workspace = join(work, 'workspace'), home = join(work, 'home'), config = join(home, '.ur')
  mkdirSync(workspace); mkdirSync(config, { recursive: true })
  const input = join(work, 'scenario.json'), report = join(work, 'report.json'), script = join(work, 'fixture.ts')
  writeFileSync(input, JSON.stringify(scenario)); writeFileSync(script, fixture)
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ provider: {
    active: 'openai-compatible', model: 'continuation-fixture', baseUrls: { 'openai-compatible': 'http://127.0.0.1:1/v1' },
  } }))
  try {
    const result = spawnSync(process.execPath, ['run', '--preload', join(root, 'plugins/bunBundleDev.ts'), script], {
      cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
      env: {
        PATH: '/usr/bin:/bin', HOME: home, USERPROFILE: home, SHELL: '/bin/sh',
        UR_CONFIG_DIR: config, UR_QUERY_SOURCE_ROOT: root, UR_QUERY_FIXTURE_DIR: workspace,
        UR_QUERY_SCENARIO: input, UR_QUERY_REPORT: report,
        UR_CODE_SIMPLE: '1', UR_CODE_DISABLE_AUTO_MEMORY: '1', UR_VERIFIER_MODE: 'off',
        UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
        UR_CODE_ENABLE_PROMPT_SUGGESTION: '0', UR_CODE_DISABLE_FAST_MODE: '1', CI: '1', NODE_ENV: 'test',
        ...(scenario.ceiling === undefined ? {} : { UR_CODE_MAX_OUTPUT_TOKENS: String(scenario.ceiling) }),
      },
    })
    expect(result.error, result.stderr).toBeUndefined()
    expect(result.status, result.stderr || result.stdout).toBe(0)
    return JSON.parse(readFileSync(report, 'utf8'))
  } finally { rmSync(work, { recursive: true, force: true }) }
}

const errors = (report: Report) => report.yielded.filter(message => message.type === 'assistant' && message.isApiErrorMessage)
const texts = (request: Request) => request.messages.flatMap(message => {
  const content = message.message?.content
  return typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => block.text) : []
})

describe('actual query output-limit continuation requests', () => {
  test('continues novel visible work beyond the former response-count ceiling and keeps diagnostic messages out of history', () => {
    const sections = Array.from({ length: 12 }, (_, index) => `Novel section ${index}: independent fixture finding.`)
    const report = runScenario({ ceiling: 8192, chunks: [...sections.map(text => ({ text, capped: true })), { text: 'Final fixture answer.' }] })
    expect(report.requests).toHaveLength(13)
    expect(report.terminal.reason).toBe('completed')
    expect(errors(report)).toHaveLength(0)
    for (const [index, request] of report.requests.entries()) {
      expect(request.model).toBe('continuation-fixture')
      expect(JSON.stringify(request.messages)).not.toContain('SYNTHETIC_OUTPUT_LIMIT_DIAGNOSTIC_')
      expect(request.maxOutputTokensOverride).toBe(4096)
      expect(texts(request).filter(text => text.startsWith('The provider ended this response at its per-response output boundary.')))
        .toHaveLength(index === 0 ? 0 : 1)
      for (const section of sections.slice(0, index)) expect(texts(request).filter(text => text === section)).toHaveLength(1)
    }
  })

  test('grows reasoning-only response budgets and actually sends a request at the ceiling before a final answer', () => {
    const report = runScenario({ ceiling: 16384, chunks: [
      { thinking: 'First private reasoning phase.', capped: true },
      { thinking: 'Second private reasoning phase.', capped: true },
      { text: 'The visible answer after sufficient output budget.' },
    ] })
    expect(report.requests.map(request => request.maxOutputTokensOverride)).toEqual([4096, 8192, 16384])
    expect(report.terminal.reason).toBe('completed')
    expect(errors(report)).toHaveLength(0)
  })

  test('streaming fallback tombstones only orphaned output and retains its buffered partial response before the boundary', () => {
    const report = runScenario({ chunks: [
      { fallbackOrphanText: 'ORPHANED_STREAM_FIXTURE', text: 'BUFFERED_PARTIAL_FIXTURE', capped: true },
      { text: 'Finished after the buffered partial response.' },
    ] })
    expect(report.requests).toHaveLength(2)
    expect(texts(report.requests[1]).filter(text => text === 'BUFFERED_PARTIAL_FIXTURE')).toHaveLength(1)
    expect(JSON.stringify(report.requests[1].messages)).not.toContain('ORPHANED_STREAM_FIXTURE')
    const tombstones = report.yielded.filter(message => message.type === 'tombstone')
    expect(tombstones).toHaveLength(1)
    expect(JSON.stringify(tombstones[0].message)).toContain('ORPHANED_STREAM_FIXTURE')
    expect(JSON.stringify(tombstones[0].message)).not.toContain('BUFFERED_PARTIAL_FIXTURE')
    expect(errors(report)).toHaveLength(0)
    expect(report.terminal.reason).toBe('completed')
  })

  test('grows after replay and preserves the raised response budget when novel output resumes', () => {
    const report = runScenario({ ceiling: 8192, chunks: [
      { text: 'Repeated visible section.', capped: true }, { text: 'Repeated visible section.', capped: true },
      { text: 'A new visible section.', capped: true }, { text: 'Completed answer.' },
    ] })
    expect(report.requests.map(request => request.maxOutputTokensOverride)).toEqual([4096, 4096, 8192, 8192])
    expect(report.terminal.reason).toBe('completed')
    expect(errors(report)).toHaveLength(0)
  })

  test('stops genuinely repeated capped output at the ceiling with one final diagnostic', () => {
    const report = runScenario({ initialBudget: 8192, ceiling: 8192, chunks: Array.from({ length: 3 }, () => ({ text: 'Stalled repeated section.', capped: true })) })
    expect(report.requests).toHaveLength(3)
    expect(report.requests.every(request => request.maxOutputTokensOverride === 8192)).toBe(true)
    expect(errors(report)).toHaveLength(1)
    expect(errors(report)[0].apiError).toBe('max_output_tokens')
    expect(report.terminal.reason).not.toBe('model_error')
  })

  test('changing private reasoning cannot hide repeated visible output in actual query recovery', () => {
    const report = runScenario({ initialBudget: 8192, ceiling: 8192, chunks: Array.from({ length: 3 }, (_, index) => ({
      text: 'Identical visible answer.', thinking: `Different private reasoning ${index}.`, capped: true,
    })) })
    expect(report.requests).toHaveLength(3)
    expect(errors(report)).toHaveLength(1)
    expect(errors(report)[0].apiError).toBe('max_output_tokens')
  })

  test('gives empty output two actual attempts at the ceiling after escalating its budget', () => {
    const report = runScenario({ ceiling: 8192, chunks: [{ capped: true }, { capped: true }, { capped: true }] })
    expect(report.requests.map(request => request.maxOutputTokensOverride)).toEqual([4096, 8192, 8192])
    expect(errors(report)).toHaveLength(1)
    expect(report.terminal.reason).not.toBe('model_error')
  })

  for (const kind of ['thinking', 'opaque'] as const) test(`bounds endlessly changing ${kind}-only capped output at the response ceiling`, () => {
    const report = runScenario({ initialBudget: 8192, ceiling: 8192, chunks: [
      { [kind]: 'Novel private phase one.', capped: true },
      { [kind]: 'Novel private phase two.', capped: true },
    ] })
    expect(report.requests.map(request => request.maxOutputTokensOverride)).toEqual([8192, 8192])
    expect(errors(report)).toHaveLength(1)
    expect(errors(report)[0].apiError).toBe('max_output_tokens')
    expect(report.terminal.reason).not.toBe('model_error')
  })

  test('a provider retry reporting a lower actual cap cannot restart the same budget escalation forever', () => {
    const report = runScenario({ ceiling: 8192, chunks: Array.from({ length: 3 }, (_, index) => ({
      thinking: `A different hidden reasoning attempt ${index}.`, capped: true,
      outputLimit: { requestedMaxTokens: index < 2 ? 4096 : 2048, inputTokens: 100, outputTokens: index < 2 ? 4096 : 2048 },
    })) })
    expect(report.requests.map(request => request.maxOutputTokensOverride)).toEqual([4096, 8192, 8192])
    expect(errors(report)).toHaveLength(1)
    expect(report.terminal.reason).not.toBe('model_error')
  })

  test('preserves partial output for emergency compaction and surfaces the context diagnostic only once', () => {
    const report = runScenario({ chunks: [{ text: 'Partial response before context rejection.', promptTooLong: true }] })
    expect(report.requests).toHaveLength(1)
    const recovery = report.compactions.filter(compaction => compaction.reason === 'context_limit')
    expect(recovery).toHaveLength(1)
    for (const messages of [recovery[0].messages, recovery[0].forkMessages]) {
      expect(JSON.stringify(messages)).toContain('Partial response before context rejection.')
      expect(JSON.stringify(messages)).not.toContain('CONTEXT_LIMIT_FIXTURE')
    }
    expect(errors(report)).toHaveLength(1)
    expect(errors(report)[0].message.content[0].text).toContain('CONTEXT_LIMIT_FIXTURE')
    expect(report.terminal.reason).toBe('prompt_too_long')
  })

  test('successful emergency compaction retries with compacted history and resets the raised output budget', () => {
    const report = runScenario({ ceiling: 8192, compactOnce: true, chunks: [
      { thinking: 'Reasoning before the output budget increases.', capped: true },
      { text: 'Partial response before successful compaction.', promptTooLong: true },
      { text: 'Completed from the compacted conversation.' },
    ] })
    expect(report.requests.map(request => request.maxOutputTokensOverride)).toEqual([4096, 8192, undefined])
    const recovery = report.compactions.filter(compaction => compaction.reason === 'context_limit')
    expect(recovery).toHaveLength(1)
    for (const messages of [recovery[0].messages, recovery[0].forkMessages]) {
      expect(JSON.stringify(messages)).toContain('Partial response before successful compaction.')
      expect(JSON.stringify(messages)).not.toContain('CONTEXT_LIMIT_FIXTURE')
      expect(JSON.stringify(messages)).not.toContain('SYNTHETIC_OUTPUT_LIMIT_DIAGNOSTIC_')
    }
    const retry = report.requests[2]
    expect(retry.messages.some(message => message.type === 'system' && message.subtype === 'compact_boundary')).toBe(true)
    expect(texts(retry)).toContain('COMPACTED_CONTEXT_FIXTURE: continue the remaining answer.')
    expect(JSON.stringify(retry.messages)).not.toContain('Partial response before successful compaction.')
    expect(JSON.stringify(retry.messages)).not.toContain('The provider ended this response')
    expect(errors(report)).toHaveLength(0)
    expect(report.terminal.reason).toBe('completed')
  })

  test('a context rejection after successful emergency compaction does not start another compaction loop', () => {
    const report = runScenario({ compactOnce: true, chunks: [
      { text: 'Partial response preserved by the first compaction.', promptTooLong: true },
      { promptTooLong: true },
    ] })
    expect(report.requests).toHaveLength(2)
    expect(report.compactions.filter(compaction => compaction.reason === 'context_limit')).toHaveLength(1)
    expect(errors(report)).toHaveLength(1)
    expect(errors(report)[0].message.content[0].text).toContain('CONTEXT_LIMIT_FIXTURE')
  })

  test('a real read-only tool call starts a fresh output phase after replay recovery', () => {
    const report = runScenario({ ceiling: 8192, chunks: [
      { text: 'Same phase text.', capped: true }, { text: 'Same phase text.', capped: true },
      { tool: true }, { text: 'Same phase text.', capped: true }, { text: 'Tool-backed final answer.' },
    ] })
    expect(report.toolCalls).toBe(1)
    expect(report.requests).toHaveLength(5)
    expect(errors(report)).toHaveLength(0)
    expect(JSON.stringify(report.requests[3].messages)).toContain('phase advanced')
    expect(report.terminal.reason).toBe('completed')
  })
})
