import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import {
  acpPermissionRequestFromControl,
  createAcpStdioAgent,
  createAcpStdioApp,
  type AcpStdioMessage,
  urPermissionDecisionFromAcp,
} from '../src/services/agents/acpStdio.js'

function makeAgent(
  runPrompt?: Parameters<typeof createAcpStdioAgent>[0]['runPrompt'],
) {
  const out: AcpStdioMessage[] = []
  const agent = createAcpStdioAgent({
    cwd: process.cwd(),
    write: (m) => out.push(m),
    runPrompt,
    persistSessions: false,
  })
  return { agent, out }
}

describe('stdio ACP agent', () => {
  test('initialize returns protocol version and capabilities', async () => {
    const { agent, out } = makeAgent()
    await agent.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })
    expect(out[0]!.id).toBe(1)
    const result = out[0]!.result as {
      protocolVersion: number
      agentCapabilities: {
        loadSession?: boolean
        mcpCapabilities?: unknown
        sessionCapabilities?: Record<string, unknown>
      }
    }
    expect(result.protocolVersion).toBe(1)
    expect(result.agentCapabilities.loadSession).toBe(true)
    expect(result.agentCapabilities.mcpCapabilities).toBeDefined()
    expect(result.agentCapabilities.sessionCapabilities).toMatchObject({
      list: {},
      delete: {},
      additionalDirectories: {},
      resume: {},
      close: {},
    })
  })

  test('session/new then session/prompt streams a chunk and returns stopReason', async () => {
    const { agent, out } = makeAgent(async (prompt, ctx) => {
      ctx.onChunk(`echo:${prompt}`)
      return { stopReason: 'end_turn' }
    })
    await agent.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: {},
    })
    const sessionId = (out[0]!.result as { sessionId: string }).sessionId
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )

    await agent.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'hello' }] },
    })

    const update = out.find(
      (m) =>
        m.method === 'session/update' &&
        (m.params as { update?: { sessionUpdate?: string } } | undefined)
          ?.update?.sessionUpdate === 'agent_message_chunk',
    )
    expect(update).toBeDefined()
    const u = update!.params as {
      update: { sessionUpdate: string; content: { text: string } }
    }
    expect(u.update.sessionUpdate).toBe('agent_message_chunk')
    expect(u.update.content.text).toBe('echo:hello')

    const final = out.find((m) => m.id === 2)
    expect((final!.result as { stopReason: string }).stopReason).toBe(
      'end_turn',
    )
  })

  test('prompt for unknown session errors', async () => {
    const { agent, out } = makeAgent()
    await agent.handle({
      jsonrpc: '2.0',
      id: 9,
      method: 'session/prompt',
      params: { sessionId: 'nope', prompt: 'hi' },
    })
    expect(out[0]!.error?.code).toBe(-32602)
    expect(out[0]!.error?.message).toContain('unknown session')
  })

  test('reuses the CLI session id across ACP prompt turns', async () => {
    const resumeIds: Array<string | undefined> = []
    const { agent, out } = makeAgent(async (_prompt, context) => {
      resumeIds.push(context.resumeSessionId)
      return {
        stopReason: 'end_turn',
        resumeSessionId: context.resumeSessionId ?? 'cli-session-1',
      }
    })
    await agent.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: {},
    })
    const sessionId = (out[0]!.result as { sessionId: string }).sessionId
    await agent.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: 'first' },
    })
    await agent.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: 'second' },
    })
    expect(resumeIds).toEqual([undefined, 'cli-session-1'])
  })

  test('passes validated MCP servers and additional roots into each prompt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-acp-roots-'))
    const additional = join(root, 'shared')
    mkdirSync(additional)
    let received:
      | {
          additionalDirectories: string[]
          mcpServers: acp.McpServer[]
        }
      | undefined
    try {
      const { agent, out } = makeAgent(async (_prompt, context) => {
        received = {
          additionalDirectories: context.additionalDirectories,
          mcpServers: context.mcpServers,
        }
        return { stopReason: 'end_turn' }
      })
      await agent.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        params: {
          cwd: root,
          additionalDirectories: [additional],
          mcpServers: [
            {
              name: 'local-test',
              command: process.execPath,
              args: ['--version'],
              env: [],
            },
          ],
        },
      })
      const sessionId = (out[0]!.result as { sessionId: string }).sessionId
      await agent.handle({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: { sessionId, prompt: 'inspect configuration' },
      })
      expect(received?.additionalDirectories).toEqual([additional])
      expect(received?.mcpServers[0]).toMatchObject({
        name: 'local-test',
        command: process.execPath,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects malformed, duplicate, and unsupported MCP configurations', async () => {
    const cases: unknown[][] = [
      [
        {
          name: 'relative-command',
          command: 'node',
          args: [],
          env: [],
        },
      ],
      [
        {
          name: 'duplicate',
          command: process.execPath,
          args: [],
          env: [],
        },
        {
          name: 'duplicate',
          command: process.execPath,
          args: [],
          env: [],
        },
      ],
      [
        {
          type: 'websocket',
          name: 'unsupported',
          url: 'https://example.test/mcp',
          headers: [],
        },
      ],
      [
        {
          type: 'http',
          name: 'header-injection',
          url: 'https://example.test/mcp',
          headers: [{ name: 'Authorization', value: 'ok\r\nInjected: yes' }],
        },
      ],
    ]

    for (const [index, mcpServers] of cases.entries()) {
      const { agent, out } = makeAgent()
      await agent.handle({
        jsonrpc: '2.0',
        id: index,
        method: 'session/new',
        params: { cwd: process.cwd(), mcpServers },
      })
      expect(out[0]?.error?.code).toBe(-32602)
    }
  })

  test('maps UR permission requests to ACP options and fails unknown outcomes closed', () => {
    const request = {
      toolName: 'Bash',
      input: { command: 'git status' },
      toolUseId: 'tool-1',
      permissionSuggestions: [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [],
        },
      ],
    }
    const mapped = acpPermissionRequestFromControl(request)
    expect(mapped.toolCall).toMatchObject({
      toolCallId: 'tool-1',
      kind: 'execute',
      status: 'pending',
    })
    expect(mapped.options.map((option) => option.kind)).toEqual([
      'allow_once',
      'allow_always',
      'reject_once',
    ])
    expect(
      urPermissionDecisionFromAcp(request, {
        outcome: { outcome: 'selected', optionId: 'allow_always' },
      }),
    ).toMatchObject({
      behavior: 'allow',
      decisionClassification: 'user_permanent',
    })
    expect(
      urPermissionDecisionFromAcp(request, {
        outcome: { outcome: 'selected', optionId: 'not-offered' },
      }),
    ).toMatchObject({ behavior: 'deny' })
  })

  test('session/cancel aborts the in-flight prompt (stopReason cancelled)', async () => {
    const { agent, out } = makeAgent(async (_prompt, ctx) => {
      // Simulate a cancel arriving mid-run by aborting through the same session.
      agentCancel()
      return { stopReason: 'end_turn' }
    })
    let agentCancel = () => {}
    await agent.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: {},
    })
    const sessionId = (out[0]!.result as { sessionId: string }).sessionId
    agentCancel = () => {
      void agent.handle({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId },
      })
    }
    await agent.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: 'work' },
    })
    const final = out.find((m) => m.id === 2)
    expect((final!.result as { stopReason: string }).stopReason).toBe(
      'cancelled',
    )
  })

  test('unknown method returns -32601', async () => {
    const { agent, out } = makeAgent()
    await agent.handle({ jsonrpc: '2.0', id: 3, method: 'does/not/exist' })
    expect(out[0]!.error?.code).toBe(-32601)
  })

  test('notifications (no id) never produce a response', async () => {
    const { agent, out } = makeAgent()
    await agent.handle({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'x' },
    })
    expect(out).toHaveLength(0)
  })

  test('official ACP transport processes cancellation while a prompt is in flight', async () => {
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const { app } = createAcpStdioApp({
      cwd: process.cwd(),
      persistSessions: false,
      runPrompt: async (_prompt, context) => {
        markStarted?.()
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) resolve()
          else
            context.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
        })
        return { stopReason: 'end_turn' }
      },
    })
    const client = acp.client({ name: 'ur-acp-test' })

    await client.connectWith(app, async (context) => {
      const initialized = await context.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      expect(initialized.protocolVersion).toBe(acp.PROTOCOL_VERSION)

      const session = await context.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })
      const prompt = context.request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'long-running work' }],
      })
      await started
      await context.notify('session/cancel', { sessionId: session.sessionId })
      await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
    })
  })

  test('official ACP transport bridges a permission request to the client', async () => {
    let requestedTool: string | undefined
    const { app } = createAcpStdioApp({
      cwd: process.cwd(),
      persistSessions: false,
      runPrompt: async (_prompt, context) => {
        const response = await context.requestPermission({
          toolCall: {
            toolCallId: 'permission-tool',
            title: 'Run tests',
            kind: 'execute',
            status: 'pending',
          },
          options: [
            {
              optionId: 'allow_once',
              name: 'Allow once',
              kind: 'allow_once',
            },
          ],
        })
        expect(response.outcome).toEqual({
          outcome: 'selected',
          optionId: 'allow_once',
        })
        return { stopReason: 'end_turn' }
      },
    })
    const client = acp
      .client({ name: 'ur-acp-permission-test' })
      .onRequest('session/request_permission', (context) => {
        requestedTool = context.params.toolCall.toolCallId
        return {
          outcome: { outcome: 'selected', optionId: 'allow_once' },
        }
      })

    await client.connectWith(app, async (context) => {
      await context.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const session = await context.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })
      await context.request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'run the tests' }],
      })
    })
    expect(requestedTool).toBe('permission-tool')
  })

  test('persists resumable identity and closes active sessions', async () => {
    const store = mkdtempSync(join(tmpdir(), 'ur-acp-session-store-'))
    const firstOut: AcpStdioMessage[] = []
    try {
      const first = createAcpStdioAgent({
        cwd: process.cwd(),
        write: (message) => firstOut.push(message),
        persistSessions: true,
        sessionStoreRoot: store,
        runPrompt: async (_prompt, context) => ({
          stopReason: 'end_turn',
          resumeSessionId: context.sessionId,
        }),
      })
      await first.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        params: { cwd: process.cwd(), mcpServers: [] },
      })
      const sessionId = (firstOut[0]!.result as { sessionId: string }).sessionId
      await first.handle({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: { sessionId, prompt: 'first turn' },
      })

      let resumedCliId: string | undefined
      const secondOut: AcpStdioMessage[] = []
      const second = createAcpStdioAgent({
        cwd: process.cwd(),
        write: (message) => secondOut.push(message),
        persistSessions: true,
        sessionStoreRoot: store,
        runPrompt: async (_prompt, context) => {
          resumedCliId = context.resumeSessionId
          return { stopReason: 'end_turn' }
        },
      })
      await second.handle({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/resume',
        params: { sessionId, cwd: process.cwd(), mcpServers: [] },
      })
      expect(
        secondOut.find((message) => message.id === 3)?.error,
      ).toBeUndefined()
      await second.handle({
        jsonrpc: '2.0',
        id: 4,
        method: 'session/prompt',
        params: { sessionId, prompt: 'second turn' },
      })
      expect(resumedCliId).toBe(sessionId)
      await second.handle({
        jsonrpc: '2.0',
        id: 5,
        method: 'session/close',
        params: { sessionId },
      })
      expect(second.sessions.has(sessionId)).toBe(false)
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  })

  test('advertises commands and applies session modes and configuration', async () => {
    let receivedMode: string | undefined
    const { agent, out } = makeAgent(async (_prompt, context) => {
      receivedMode = context.mode
      await context.onToolUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-config-test',
        title: 'Read',
        kind: 'read',
        status: 'in_progress',
      })
      await context.onChunk('configured output')
      return { stopReason: 'end_turn' }
    })

    await agent.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: {},
    })
    const created = out.find((message) => message.id === 1)?.result as {
      sessionId: string
      modes: { currentModeId: string; availableModes: Array<{ id: string }> }
      configOptions: Array<{ id: string; currentValue: string }>
    }
    expect(created.modes.currentModeId).toBe('default')
    expect(created.modes.availableModes.map((mode) => mode.id)).toEqual([
      'default',
      'acceptEdits',
      'plan',
    ])
    expect(created.configOptions).toContainEqual(
      expect.objectContaining({ id: 'tool_updates', currentValue: 'stream' }),
    )
    const commands = out.find(
      (message) =>
        message.method === 'session/update' &&
        (message.params as { update?: { sessionUpdate?: string } }).update
          ?.sessionUpdate === 'available_commands_update',
    )
    expect(
      (
        commands?.params as {
          update: { availableCommands: Array<{ name: string }> }
        }
      ).update.availableCommands.map((command) => command.name),
    ).toEqual(expect.arrayContaining(['help', 'review', 'compact', 'skills']))

    await agent.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/set_mode',
      params: { sessionId: created.sessionId, modeId: 'plan' },
    })
    await agent.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/set_config_option',
      params: {
        sessionId: created.sessionId,
        configId: 'tool_updates',
        value: 'permissions_only',
      },
    })
    expect(out.find((message) => message.id === 3)?.result).toMatchObject({
      configOptions: [
        expect.objectContaining({
          id: 'tool_updates',
          currentValue: 'permissions_only',
        }),
      ],
    })

    out.length = 0
    await agent.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'session/prompt',
      params: { sessionId: created.sessionId, prompt: 'respect the mode' },
    })
    expect(receivedMode).toBe('plan')
    expect(
      out.some(
        (message) =>
          (
            message.params as
              { update?: { sessionUpdate?: string } } | undefined
          )?.update?.sessionUpdate === 'tool_call',
      ),
    ).toBe(false)

    out.length = 0
    await agent.handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'session/load',
      params: {
        sessionId: created.sessionId,
        cwd: process.cwd(),
        mcpServers: [],
      },
    })
    const replayedKinds = out
      .filter((message) => message.method === 'session/update')
      .map(
        (message) =>
          (message.params as { update: { sessionUpdate: string } }).update
            .sessionUpdate,
      )
    expect(replayedKinds.slice(0, 3)).toEqual([
      'user_message_chunk',
      'tool_call',
      'agent_message_chunk',
    ])
  })

  test('lists, loads, and deletes private persisted sessions without credentials', async () => {
    const store = mkdtempSync(join(tmpdir(), 'ur-acp-lifecycle-store-'))
    const firstOut: AcpStdioMessage[] = []
    try {
      const first = createAcpStdioAgent({
        cwd: process.cwd(),
        write: (message) => firstOut.push(message),
        persistSessions: true,
        sessionStoreRoot: store,
        runPrompt: async (_prompt, context) => {
          await context.onChunk('persisted answer')
          return {
            stopReason: 'end_turn',
            resumeSessionId: 'private-cli-session',
          }
        },
      })
      await first.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        params: {
          cwd: process.cwd(),
          mcpServers: [
            {
              name: 'private-test',
              command: process.execPath,
              args: [],
              env: [{ name: 'TOKEN', value: 'must-not-persist' }],
            },
          ],
        },
      })
      const sessionId = (
        firstOut.find((message) => message.id === 1)?.result as {
          sessionId: string
        }
      ).sessionId
      await first.handle({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: { sessionId, prompt: 'A persisted lifecycle title' },
      })
      await first.handle({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/close',
        params: { sessionId },
      })

      const metadataPath = join(store, 'acp', 'sessions', `${sessionId}.json`)
      const historyPath = join(store, 'acp', 'history', `${sessionId}.jsonl`)
      expect(statSync(metadataPath).mode & 0o777).toBe(0o600)
      expect(statSync(historyPath).mode & 0o777).toBe(0o600)
      expect(readFileSync(metadataPath, 'utf8')).not.toContain(
        'must-not-persist',
      )

      const secondOut: AcpStdioMessage[] = []
      const second = createAcpStdioAgent({
        cwd: process.cwd(),
        write: (message) => secondOut.push(message),
        persistSessions: true,
        sessionStoreRoot: store,
      })
      await second.handle({
        jsonrpc: '2.0',
        id: 4,
        method: 'session/list',
        params: { cwd: process.cwd() },
      })
      expect(
        secondOut.find((message) => message.id === 4)?.result,
      ).toMatchObject({
        sessions: [
          expect.objectContaining({
            sessionId,
            cwd: process.cwd(),
            title: 'A persisted lifecycle title',
          }),
        ],
      })

      secondOut.length = 0
      await second.handle({
        jsonrpc: '2.0',
        id: 5,
        method: 'session/load',
        params: { sessionId, cwd: process.cwd(), mcpServers: [] },
      })
      const replay = secondOut
        .filter((message) => message.method === 'session/update')
        .map(
          (message) =>
            (message.params as { update: { sessionUpdate: string } }).update
              .sessionUpdate,
        )
      expect(replay.slice(0, 2)).toEqual([
        'user_message_chunk',
        'agent_message_chunk',
      ])

      await second.handle({
        jsonrpc: '2.0',
        id: 6,
        method: 'session/delete',
        params: { sessionId },
      })
      expect(existsSync(metadataPath)).toBe(false)
      expect(existsSync(historyPath)).toBe(false)
      secondOut.length = 0
      await second.handle({
        jsonrpc: '2.0',
        id: 7,
        method: 'session/list',
        params: {},
      })
      expect(secondOut.find((message) => message.id === 7)?.result).toEqual({
        sessions: [],
      })
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  })

  test('paginates session/list with an opaque filter-bound cursor', async () => {
    const { agent, out } = makeAgent()
    for (let index = 0; index < 51; index++) {
      await agent.handle({
        jsonrpc: '2.0',
        id: index,
        method: 'session/new',
        params: {},
      })
    }
    out.length = 0
    await agent.handle({
      jsonrpc: '2.0',
      id: 100,
      method: 'session/list',
      params: { cwd: process.cwd() },
    })
    const firstPage = out.find((message) => message.id === 100)?.result as {
      sessions: Array<{ sessionId: string }>
      nextCursor: string
    }
    expect(firstPage.sessions).toHaveLength(50)
    expect(firstPage.nextCursor).toBeString()

    await agent.handle({
      jsonrpc: '2.0',
      id: 101,
      method: 'session/list',
      params: { cwd: process.cwd(), cursor: firstPage.nextCursor },
    })
    const secondPage = out.find((message) => message.id === 101)?.result as {
      sessions: Array<{ sessionId: string }>
    }
    expect(secondPage.sessions).toHaveLength(1)
    expect(
      firstPage.sessions.some(
        (session) => session.sessionId === secondPage.sessions[0]!.sessionId,
      ),
    ).toBe(false)

    await agent.handle({
      jsonrpc: '2.0',
      id: 102,
      method: 'session/list',
      params: { cursor: firstPage.nextCursor },
    })
    expect(out.find((message) => message.id === 102)?.error?.code).toBe(-32602)
  })
})
