import { expect, test } from 'bun:test'
import {
  createOllamaURHQClient,
  mergeToolCalls,
  type OllamaToolCall,
} from '../src/services/api/ollama.js'
import { parseToolInputJsonLenient } from '../src/utils/json.js'

type OllamaTestMode = 'streaming' | 'non-streaming'

type OllamaFixture = {
  capabilities?: string[]
  message?: Record<string, unknown>
  streamChunks?: Record<string, unknown>[]
  tools?: Array<{
    name: string
    description: string
    input_schema: Record<string, unknown>
  }>
}

const OLLAMA_AUDIT_TOOLS = [
  {
    name: 'Write',
    description: 'Write a file',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'Bash',
    description: 'Run a command',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'Read',
    description: 'Read a file',
    input_schema: { type: 'object', properties: {} },
  },
]

async function runOllamaFixture(
  fixtureName: string,
  mode: OllamaTestMode,
  fixture: OllamaFixture,
): Promise<any> {
  const originalFetch = globalThis.fetch
  const model = `ollama-audit-${fixtureName}-${mode}`
  const baseUrl = `http://${model}`
  const message = fixture.message ?? {
    role: 'assistant',
    content: 'ok',
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/show')) {
      return new Response(
        JSON.stringify({
          capabilities: fixture.capabilities ?? ['tools'],
        }),
        { status: 200 },
      )
    }

    const request = JSON.parse(String(init?.body)) as { stream?: boolean }
    if (request.stream) {
      const chunks =
        fixture.streamChunks ??
        [
          {
            model,
            message,
            done: true,
            done_reason: 'stop',
          },
        ]
      return new Response(`${chunks.map(chunk => JSON.stringify(chunk)).join('\n')}\n`, {
        status: 200,
      })
    }

    return new Response(
      JSON.stringify({
        model,
        message,
        done: true,
        done_reason: 'stop',
      }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    const client = createOllamaURHQClient({
      baseUrlOverride: baseUrl,
    }) as any
    const params = {
      model,
      messages: [{ role: 'user', content: 'exercise the tool-call contract' }],
      max_tokens: 64,
      tools: fixture.tools ?? OLLAMA_AUDIT_TOOLS,
    }

    if (mode === 'non-streaming') {
      return await client.beta.messages.create(params)
    }

    const { data } = await client.beta.messages
      .create({ ...params, stream: true })
      .withResponse()
    const events: any[] = []
    for await (const event of data) {
      events.push(event)
    }
    return events
  } finally {
    globalThis.fetch = originalFetch
  }
}

function toolUsesFromResult(
  mode: OllamaTestMode,
  result: any,
): Array<Record<string, any>> {
  if (mode === 'non-streaming') {
    return result.content.filter(
      (block: Record<string, unknown>) => block.type === 'tool_use',
    )
  }
  return result
    .filter(
      (event: Record<string, any>) =>
        event.type === 'content_block_start' &&
        event.content_block?.type === 'tool_use',
    )
    .map((event: Record<string, any>) => ({
      ...event.content_block,
      index: event.index,
    }))
}

function visibleTextFromResult(mode: OllamaTestMode, result: any): string {
  if (mode === 'non-streaming') {
    return result.content
      .filter((block: Record<string, unknown>) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('')
  }
  return result
    .filter(
      (event: Record<string, any>) =>
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta',
    )
    .map((event: Record<string, any>) => event.delta.text)
    .join('')
}

function streamedToolInputs(events: any[]): Array<Record<string, unknown>> {
  const tools = new Map<
    number,
    { name: string; id: string; inputJson: string }
  >()
  for (const event of events) {
    if (
      event.type === 'content_block_start' &&
      event.content_block?.type === 'tool_use'
    ) {
      tools.set(event.index, {
        name: event.content_block.name,
        id: event.content_block.id,
        inputJson: '',
      })
    } else if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'input_json_delta'
    ) {
      const tool = tools.get(event.index)
      if (tool) {
        tool.inputJson += event.delta.partial_json
      }
    }
  }
  return [...tools.values()].map(tool => ({
    name: tool.name,
    id: tool.id,
    input: JSON.parse(tool.inputJson || '{}'),
  }))
}

// --- mergeToolCalls: Ollama streams each completed tool call in its own
// chunk as a single-element array. The old positional merge collapsed
// multi-call turns into just the last call.

test('mergeToolCalls keeps multiple calls streamed in separate chunks', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a/__init__.py', content: '' } } },
  ])
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a/test_x.py', content: 'def test(): pass' } } },
  ])
  mergeToolCalls(target, [
    { function: { name: 'Bash', arguments: { command: 'pytest' } } },
  ])
  expect(target).toHaveLength(3)
  expect(target[0]?.function?.name).toBe('Write')
  expect((target[0]?.function?.arguments as Record<string, unknown>).file_path).toBe('/a/__init__.py')
  expect((target[1]?.function?.arguments as Record<string, unknown>).file_path).toBe('/a/test_x.py')
  expect(target[2]?.function?.name).toBe('Bash')
})

test('mergeToolCalls does not clobber good arguments with a later empty resend', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a.py', content: 'x = 1' } } },
  ])
  mergeToolCalls(target, [{ function: { name: 'Write', arguments: {} } }])
  expect(target).toHaveLength(1)
  expect((target[0]?.function?.arguments as Record<string, unknown>).content).toBe('x = 1')
})

test('mergeToolCalls concatenates string argument fragments for the same call', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: '{"file_pa' } },
  ])
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: 'th": "/a.py", "content": "hi"}' } },
  ])
  expect(target).toHaveLength(1)
  expect(target[0]?.function?.arguments).toBe(
    '{"file_path": "/a.py", "content": "hi"}',
  )
})

test('mergeToolCalls treats nameless entries as fragments of the last call', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [{ function: { name: 'Bash', arguments: '{"comm' } }])
  mergeToolCalls(target, [{ function: { arguments: 'and": "ls"}' } }])
  expect(target).toHaveLength(1)
  expect(target[0]?.function?.arguments).toBe('{"command": "ls"}')
})

test('mergeToolCalls repairs argument-first fragments when the name arrives later', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [{ function: { arguments: '{"command":' } }])
  mergeToolCalls(target, [
    { function: { name: 'Bash', arguments: '"ls"}' } },
  ])
  expect(target).toEqual([
    { function: { name: 'Bash', arguments: '{"command":"ls"}' } },
  ])
})

test('mergeToolCalls rejects a missing function envelope', () => {
  expect(() => mergeToolCalls([], [{}])).toThrow('without a function payload')
})

test('mergeToolCalls is idempotent for cumulative-style resends', () => {
  const call: OllamaToolCall = {
    function: { name: 'Read', arguments: { file_path: '/a.py' } },
  }
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [call])
  mergeToolCalls(target, [call])
  expect(target).toHaveLength(1)
})

test('mergeToolCalls keeps distinct complete same-name string calls separate', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    {
      function: {
        name: 'Write',
        arguments: '{"file_path":"/a.py","content":"a"}',
      },
    },
  ])
  mergeToolCalls(target, [
    {
      function: {
        name: 'Write',
        arguments: '{"file_path":"/b.py","content":"b"}',
      },
    },
  ])

  expect(target).toHaveLength(2)
  expect(target.map(call => call.function?.arguments)).toEqual([
    '{"file_path":"/a.py","content":"a"}',
    '{"file_path":"/b.py","content":"b"}',
  ])
})

test('mergeToolCalls dedupes a cumulative complete string resend', () => {
  const call: OllamaToolCall = {
    function: {
      name: 'Write',
      arguments: '{"file_path":"/a.py","content":"a"}',
    },
  }
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [call])
  mergeToolCalls(target, [call])

  expect(target).toEqual([call])
})

test('mergeToolCalls merges object fragments shallowly', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a.py' } } },
  ])
  mergeToolCalls(target, [{ function: { arguments: { content: 'x' } } }])
  expect(target).toHaveLength(1)
  expect(target[0]?.function?.arguments).toEqual({
    file_path: '/a.py',
    content: 'x',
  })
})

// --- parseToolInputJsonLenient: repairs the almost-JSON local models emit.

test('lenient parser accepts strict JSON unchanged', () => {
  expect(parseToolInputJsonLenient('{"a": 1}')).toEqual({ a: 1 })
})

test('lenient parser repairs raw newlines inside string values', () => {
  const raw = '{"file_path": "/a.py", "content": "line1\nline2\n"}'
  expect(parseToolInputJsonLenient(raw)).toEqual({
    file_path: '/a.py',
    content: 'line1\nline2\n',
  })
})

test('lenient parser repairs raw tabs and control chars', () => {
  const raw = '{"content": "a\tb\rc"}'
  expect(parseToolInputJsonLenient(raw)).toEqual({ content: 'a\tb\rc' })
})

test('lenient parser strips markdown fences and trailing commas', () => {
  const raw = '```json\n{"command": "ls",}\n```'
  expect(parseToolInputJsonLenient(raw)).toEqual({ command: 'ls' })
})

test('lenient parser preserves already-escaped sequences', () => {
  const raw = '{"content": "a\\nb"}'
  expect(parseToolInputJsonLenient(raw)).toEqual({ content: 'a\nb' })
})

test('lenient parser returns null for hopeless input', () => {
  expect(parseToolInputJsonLenient('not json at all')).toBeNull()
  expect(parseToolInputJsonLenient('')).toBeNull()
})

// --- Canonical arg keys: dedup must not be defeated by key order.

test('mergeToolCalls dedupes cumulative resends regardless of key order', () => {
  const target: OllamaToolCall[] = []
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { file_path: '/a.py', content: 'x' } } },
  ])
  mergeToolCalls(target, [
    { function: { name: 'Write', arguments: { content: 'x', file_path: '/a.py' } } },
  ])
  expect(target).toHaveLength(1)
})

test('Ollama clients keep endpoints and capability caches instance-scoped', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; body: any }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body))
    requests.push({ url, body })
    if (url.endsWith('/api/show')) {
      return new Response(
        JSON.stringify({
          capabilities: url.startsWith('http://host-a')
            ? ['tools']
            : [],
        }),
        { status: 200 },
      )
    }
    return new Response(
      JSON.stringify({
        model: body.model,
        message: { role: 'assistant', content: 'ok' },
        done: true,
      }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    const clientA = createOllamaURHQClient({
      baseUrlOverride: 'http://host-a',
    }) as any
    // Constructing B used to mutate a module global and retarget A.
    const clientB = createOllamaURHQClient({
      baseUrlOverride: 'http://host-b',
    }) as any
    const params = {
      model: 'same-model-instance-scope-test',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 16,
      tools: [
        {
          name: 'Read',
          description: 'Read',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    }
    await clientA.beta.messages.create(params)
    await clientB.beta.messages.create(params)

    expect(requests.map(request => request.url)).toEqual([
      'http://host-a/api/show',
      'http://host-a/api/chat',
      'http://host-b/api/show',
      'http://host-b/api/chat',
    ])
    expect(requests[1]?.body.tools).toHaveLength(1)
    expect(requests[3]?.body.tools).toBeUndefined()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Ollama rejects irreparable structured arguments instead of executing {}', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/api/show')) {
      return new Response(JSON.stringify({ capabilities: ['tools'] }), {
        status: 200,
      })
    }
    return new Response(
      JSON.stringify({
        model: 'bad-args-model',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: {
                name: 'Write',
                arguments: '{"file_path":',
              },
            },
          ],
        },
        done: true,
      }),
      { status: 200 },
    )
  }) as typeof fetch
  try {
    const client = createOllamaURHQClient({
      baseUrlOverride: 'http://malformed-host',
    }) as any
    await expect(
      client.beta.messages.create({
        model: 'bad-args-model',
        messages: [{ role: 'user', content: 'write' }],
        max_tokens: 16,
        tools: [],
      }),
    ).rejects.toThrow('not valid JSON after conservative repair')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Ollama keeps bare JSON as text when native tools are available', async () => {
  const bareJson = '{"command":"echo this is an example, not a call"}'

  for (const mode of ['non-streaming', 'streaming'] as const) {
    const result = await runOllamaFixture(`native-bare-json-${mode}`, mode, {
      capabilities: ['tools'],
      message: {
        role: 'assistant',
        content: bareJson,
      },
    })

    expect(toolUsesFromResult(mode, result)).toHaveLength(0)
    expect(visibleTextFromResult(mode, result)).toBe(bareJson)
  }
})

test('Ollama rejects malformed Kimi arguments instead of emitting empty input', async () => {
  const malformed =
    '<|tool_call_begin|>Write<|tool_call_argument_begin|>' +
    '{"file_path":<|tool_call_end|>'

  for (const mode of ['non-streaming', 'streaming'] as const) {
    await expect(
      runOllamaFixture(`malformed-kimi-${mode}`, mode, {
        capabilities: [],
        message: {
          role: 'assistant',
          content: malformed,
        },
        tools: [OLLAMA_AUDIT_TOOLS[0]!],
      }),
    ).rejects.toThrow()
  }
})

test('Ollama rejects unknown and whitespace-only structured tool names', async () => {
  for (const rawName of ['DefinitelyNotAvailable', '   ']) {
    for (const mode of ['non-streaming', 'streaming'] as const) {
      await expect(
        runOllamaFixture(
          `invalid-name-${rawName.trim() || 'whitespace'}-${mode}`,
          mode,
          {
            capabilities: ['tools'],
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  function: {
                    name: rawName,
                    arguments: {},
                  },
                },
              ],
            },
            tools: [OLLAMA_AUDIT_TOOLS[2]!],
          },
        ),
      ).rejects.toThrow()
    }
  }
})

test('Ollama canonically dedupes structured and text-form tool calls', async () => {
  const fixtures: Array<{
    name: string
    capabilities: string[]
    message: Record<string, unknown>
  }> = [
    {
      name: 'same-source-structured',
      capabilities: ['tools'],
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'Write',
              arguments: { file_path: '/same.py', content: 'x' },
            },
          },
          {
            function: {
              name: 'Write',
              arguments: { content: 'x', file_path: '/same.py' },
            },
          },
        ],
      },
    },
    {
      name: 'structured-and-text',
      capabilities: [],
      message: {
        role: 'assistant',
        content: '{"content":"x","file_path":"/same.py"}',
        tool_calls: [
          {
            function: {
              name: 'Write',
              arguments: { file_path: '/same.py', content: 'x' },
            },
          },
        ],
      },
    },
    {
      name: 'same-source-text',
      capabilities: [],
      message: {
        role: 'assistant',
        content:
          '{"file_path":"/same.py","content":"x"}\n' +
          '{"content":"x","file_path":"/same.py"}\n',
      },
    },
  ]

  for (const fixture of fixtures) {
    for (const mode of ['non-streaming', 'streaming'] as const) {
      const result = await runOllamaFixture(
        `dedupe-${fixture.name}-${mode}`,
        mode,
        {
          capabilities: fixture.capabilities,
          message: fixture.message,
          tools: [OLLAMA_AUDIT_TOOLS[0]!],
        },
      )

      expect(toolUsesFromResult(mode, result)).toHaveLength(1)
      expect(toolUsesFromResult(mode, result)[0]?.name).toBe('Write')
    }
  }
})

test('Ollama streaming keeps distinct complete same-name string calls separate', async () => {
  const events = await runOllamaFixture(
    'distinct-complete-string-calls',
    'streaming',
    {
      capabilities: ['tools'],
      tools: [OLLAMA_AUDIT_TOOLS[0]!],
      streamChunks: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'Write',
                  arguments: '{"file_path":"/a.py","content":"a"}',
                },
              },
            ],
          },
          done: false,
        },
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'Write',
                  arguments: '{"file_path":"/b.py","content":"b"}',
                },
              },
            ],
          },
          done: false,
        },
        {
          message: { role: 'assistant', content: '' },
          done: true,
          done_reason: 'tool_calls',
        },
      ],
    },
  )

  expect(streamedToolInputs(events).map(tool => tool.input)).toEqual([
    { file_path: '/a.py', content: 'a' },
    { file_path: '/b.py', content: 'b' },
  ])
})

test('Ollama streaming dedupes a cumulative complete string resend', async () => {
  const repeated = {
    function: {
      name: 'Write',
      arguments: '{"file_path":"/a.py","content":"a"}',
    },
  }
  const events = await runOllamaFixture(
    'cumulative-complete-string-resend',
    'streaming',
    {
      capabilities: ['tools'],
      tools: [OLLAMA_AUDIT_TOOLS[0]!],
      streamChunks: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [repeated],
          },
          done: false,
        },
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [repeated],
          },
          done: false,
        },
        {
          message: { role: 'assistant', content: '' },
          done: true,
          done_reason: 'tool_calls',
        },
      ],
    },
  )

  expect(streamedToolInputs(events)).toHaveLength(1)
  expect(streamedToolInputs(events)[0]?.input).toEqual({
    file_path: '/a.py',
    content: 'a',
  })
})

test('Ollama assigns unique IDs to distinct streamed fallback calls', async () => {
  const originalNow = Date.now
  Date.now = () => 123
  try {
    const events = await runOllamaFixture(
      'unique-fallback-ids',
      'streaming',
      {
        capabilities: [],
        tools: [OLLAMA_AUDIT_TOOLS[1]!],
        streamChunks: [
          {
            message: {
              role: 'assistant',
              content: '{"command":"echo one"}\n',
            },
            done: false,
          },
          {
            message: {
              role: 'assistant',
              content: '{"command":"echo two"}\n',
            },
            done: false,
          },
          {
            message: { role: 'assistant', content: '' },
            done: true,
            done_reason: 'stop',
          },
        ],
      },
    )

    const toolUses = toolUsesFromResult('streaming', events)
    expect(toolUses).toHaveLength(2)
    expect(new Set(toolUses.map(tool => tool.id)).size).toBe(2)
  } finally {
    Date.now = originalNow
  }
})

test('malformed Kimi markup has nonempty, mode-consistent handling', async () => {
  const malformed =
    '<|tool_call_begin|>Write<|tool_call_argument_begin|>{"file_path":'
  const outcomes: Array<
    | { kind: 'error' }
    | { kind: 'success'; text: string; toolCount: number }
  > = []

  for (const mode of ['non-streaming', 'streaming'] as const) {
    try {
      const result = await runOllamaFixture(
        `incomplete-kimi-parity-${mode}`,
        mode,
        {
          capabilities: [],
          message: {
            role: 'assistant',
            content: malformed,
          },
          tools: [OLLAMA_AUDIT_TOOLS[0]!],
        },
      )
      outcomes.push({
        kind: 'success',
        text: visibleTextFromResult(mode, result),
        toolCount: toolUsesFromResult(mode, result).length,
      })
    } catch {
      outcomes.push({ kind: 'error' })
    }
  }

  expect(outcomes[0]?.kind).toBe(outcomes[1]?.kind)
  for (const outcome of outcomes) {
    if (outcome.kind === 'success') {
      expect(outcome.text.trim().length).toBeGreaterThan(0)
      expect(outcome.toolCount).toBe(0)
    }
  }
})
