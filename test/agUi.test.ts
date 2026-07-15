import { describe, expect, test } from 'bun:test'
import { EventSchemas, EventType } from '@ag-ui/core'
import {
  createAgUiHttpHandler,
  getAgUiCapabilities,
  validateAgUiServeOptions,
} from '../src/entrypoints/agUi.js'
import {
  buildAgUiPrompt,
  parseAgUiRunInput,
  parseUrStreamJsonUpdates,
  type AgUiPromptRunner,
} from '../src/services/agents/agUi.js'

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    state: { branch: 'main' },
    messages: [
      { id: 'message-1', role: 'user', content: 'Review this change.' },
    ],
    tools: [],
    context: [{ description: 'repository', value: 'UR' }],
    forwardedProps: {},
    ...overrides,
  }
}

function request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://127.0.0.1/ag-ui', {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function parseSse(text: string): unknown[] {
  return text
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice('data: '.length)))
}

describe('AG-UI input contract', () => {
  test('parses the official schema and retains transcript context as untrusted data', () => {
    const parsed = parseAgUiRunInput(
      input({
        messages: [
          { id: 'system-1', role: 'system', content: 'Client instruction' },
          {
            id: 'user-1',
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      }),
    )
    const prompt = buildAgUiPrompt(parsed)
    expect(prompt).toContain('untrusted client-supplied')
    expect(prompt).toContain('Client instruction')
    expect(prompt).toContain('Hello')
  })

  test('rejects unsupported capabilities instead of silently dropping them', () => {
    expect(() =>
      parseAgUiRunInput(
        input({
          tools: [
            { name: 'frontend_tool', description: 'Run in UI', parameters: {} },
          ],
        }),
      ),
    ).toThrow('does not advertise client-provided tools')
    expect(() =>
      parseAgUiRunInput(
        input({
          messages: [
            {
              id: 'message-1',
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'url', value: 'https://example.com/a.png' },
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow('accepts text input only')
    expect(() =>
      parseAgUiRunInput(
        input({ resume: [{ interruptId: 'i-1', status: 'resolved' }] }),
      ),
    ).toThrow('does not advertise AG-UI interrupt')
  })

  test('requires all RunAgentInput fields, unique bounded ids, and a user message', () => {
    const missing = input()
    delete missing.state
    expect(() => parseAgUiRunInput(missing)).toThrow('state is required')
    expect(() =>
      parseAgUiRunInput(
        input({
          messages: [
            { id: 'same', role: 'user', content: 'one' },
            { id: 'same', role: 'assistant', content: 'two' },
          ],
        }),
      ),
    ).toThrow('Duplicate AG-UI message id')
    expect(() =>
      parseAgUiRunInput(
        input({
          messages: [{ id: 'assistant-1', role: 'assistant', content: 'done' }],
        }),
      ),
    ).toThrow('at least one user message')
  })

  test('translates UR text and tool envelopes without accepting malformed events', () => {
    expect(
      parseUrStreamJsonUpdates({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hello' },
        },
      }),
    ).toEqual([{ kind: 'text', delta: 'hello' }])
    expect(
      parseUrStreamJsonUpdates({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file: 'a' } },
          ],
        },
      }),
    ).toEqual([
      {
        kind: 'tool',
        update: {
          kind: 'start',
          toolCallId: 'tool-1',
          name: 'Read',
          input: { file: 'a' },
        },
      },
    ])
    expect(parseUrStreamJsonUpdates({ type: 'stream_event', event: {} })).toEqual(
      [],
    )
    expect(
      parseUrStreamJsonUpdates({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'x'.repeat(257), name: 'Read', input: {} },
            { type: 'tool_use', id: 'tool-2', name: 'bad\nname', input: {} },
          ],
        },
      }),
    ).toEqual([])
  })
})

describe('AG-UI HTTP adapter', () => {
  test('emits an official, ordered lifecycle with state, text, and tool events', async () => {
    const runner: AgUiPromptRunner = async (_prompt, context) => {
      await context.onTextDelta('Hello ')
      await context.onToolUpdate({
        kind: 'start',
        toolCallId: 'tool-1',
        name: 'Read',
        input: { file_path: 'README.md' },
      })
      await context.onToolUpdate({
        kind: 'result',
        toolCallId: 'tool-1',
        output: 'contents',
        failed: false,
      })
      await context.onTextDelta('world')
      return { stopReason: 'end_turn' }
    }
    const handler = createAgUiHttpHandler({ cwd: process.cwd(), runPrompt: runner })
    const response = await handler(request(input()))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const events = parseSse(await response.text())
    for (const event of events) {
      expect(EventSchemas.safeParse(event).success).toBe(true)
    }
    expect(events.map(event => (event as { type: string }).type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.STEP_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STEP_FINISHED,
      EventType.RUN_FINISHED,
    ])
    expect(events.at(-1)).toMatchObject({
      threadId: 'thread-1',
      runId: 'run-1',
      outcome: { type: 'success' },
    })
  })

  test('returns truthful capability discovery without overclaiming transports', async () => {
    const capabilities = getAgUiCapabilities()
    expect(capabilities.transport).toEqual({
      streaming: true,
      websocket: false,
      httpBinary: false,
      pushNotifications: false,
      resumable: false,
    })
    expect(capabilities.tools?.clientProvided).toBe(false)
    expect(capabilities.reasoning?.supported).toBe(false)
    expect(capabilities.humanInTheLoop?.supported).toBe(false)

    const handler = createAgUiHttpHandler({ cwd: process.cwd() })
    const response = await handler(
      new Request('http://127.0.0.1/ag-ui/capabilities'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(capabilities)
  })

  test('enforces bearer auth, exact CORS, media type, and Accept negotiation', async () => {
    const handler = createAgUiHttpHandler({
      cwd: process.cwd(),
      token: 'top-secret',
      allowedOrigins: ['https://app.example'],
      runPrompt: async () => ({ stopReason: 'end_turn' }),
    })
    expect(
      (await handler(request(input(), { origin: 'https://app.example' }))).status,
    ).toBe(401)
    expect(
      (
        await handler(
          request(input(), {
            authorization: 'Bearer top-secret',
            origin: 'https://evil.example',
          }),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await handler(
          request(input(), {
            accept: 'application/json',
            authorization: 'Bearer top-secret',
            origin: 'https://app.example',
          }),
        )
      ).status,
    ).toBe(406)
    expect(
      (
        await handler(
          request(input(), {
            accept: 'text/event-stream;q=1.1',
            authorization: 'Bearer top-secret',
            origin: 'https://app.example',
          }),
        )
      ).status,
    ).toBe(406)
    const wrongType = new Request('http://127.0.0.1/ag-ui', {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        authorization: 'Bearer top-secret',
        'content-type': 'text/plain',
        origin: 'https://app.example',
      },
      body: JSON.stringify(input()),
    })
    expect((await handler(wrongType)).status).toBe(415)
  })

  test('rejects control characters in configured bearer tokens', () => {
    expect(() =>
      validateAgUiServeOptions({
        cwd: process.cwd(),
        host: '127.0.0.1',
        port: 8977,
        token: 'bad\ntoken',
      }),
    ).toThrow('non-empty safe string')
  })

  test('turns runner failures into terminal, redacted RUN_ERROR events', async () => {
    const handler = createAgUiHttpHandler({
      cwd: process.cwd(),
      runPrompt: async () => {
        throw new Error('provider secret sk-test-private')
      },
    })
    const response = await handler(request(input()))
    const text = await response.text()
    const events = parseSse(text)
    expect(events.at(-1)).toEqual({
      type: EventType.RUN_ERROR,
      message: 'UR agent run failed.',
      code: 'AGENT_RUN_FAILED',
    })
    expect(text).not.toContain('sk-test-private')
  })

  test('rejects duplicate active run ids and aborts work when the client disconnects', async () => {
    let signalSeen: AbortSignal | undefined
    let resolveEnded: (() => void) | undefined
    const ended = new Promise<void>(resolve => {
      resolveEnded = resolve
    })
    const handler = createAgUiHttpHandler({
      cwd: process.cwd(),
      runPrompt: async (_prompt, context) => {
        signalSeen = context.signal
        await new Promise<void>(resolve => {
          if (context.signal.aborted) resolve()
          else context.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        resolveEnded?.()
        return { stopReason: 'cancelled' }
      },
    })
    const first = await handler(request(input()))
    expect(signalSeen?.aborted).toBe(false)
    const duplicate = await handler(request(input()))
    expect(duplicate.status).toBe(409)
    await first.body?.cancel('test disconnect')
    await ended
    expect(signalSeen?.aborted).toBe(true)
  })
})

test('AG-UI server refuses unsafe network exposure', () => {
  expect(() =>
    validateAgUiServeOptions({
      cwd: process.cwd(),
      host: '0.0.0.0',
      port: 8977,
    }),
  ).toThrow('without a bearer token')
  expect(() =>
    validateAgUiServeOptions({
      cwd: process.cwd(),
      host: '0.0.0.0',
      port: 8977,
      token: 'secret',
      allowedOrigins: ['https://app.example/path'],
    }),
  ).toThrow('exact HTTP(S) origin')
})
