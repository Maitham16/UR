import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  MCP_2026_PROTOCOL_VERSION,
  MCP_APP_MIME_TYPE,
  MCP_APPS_EXTENSION,
  MCP_TASKS_EXTENSION,
  Mcp2026Runtime,
  UR_MCP_APP_URI,
  UR_MCP_ASYNC_TOOL,
  UR_MCP_OVERVIEW_TOOL,
  urMcpAppHtml,
  type Mcp2026ToolBackend,
} from '../src/services/mcp/mcp2026.js'
import { createMcp2026HttpHandler } from '../src/entrypoints/mcp2026.js'

function cwd(): string {
  return mkdtempSync(join(tmpdir(), 'ur-mcp-2026-'))
}

function backend(
  callTool: Mcp2026ToolBackend['callTool'] = async name => ({
    content: [{ type: 'text', text: `called ${name}` }],
  }),
): Mcp2026ToolBackend {
  return {
    listTools: async () => ({
      tools: [
        {
          name: 'echo',
          description: 'Echo a value.',
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
          },
        },
      ],
    }),
    callTool,
  }
}

const noCapabilities = {}
const allCapabilities = {
  extensions: {
    [MCP_TASKS_EXTENSION]: {},
    [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APP_MIME_TYPE] },
  },
}

function context(
  owner = 'owner',
  clientCapabilities: Record<string, unknown> = allCapabilities,
) {
  return {
    owner,
    clientCapabilities,
    signal: new AbortController().signal,
  }
}

function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: '2.0', id, method, params }
}

function meta(capabilities: Record<string, unknown> = allCapabilities) {
  return {
    'io.modelcontextprotocol/protocolVersion': MCP_2026_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': {
      name: 'mcp-2026-test',
      version: '1.0.0',
    },
    'io.modelcontextprotocol/clientCapabilities': capabilities,
  }
}

function httpRequest(
  method: string,
  params: Record<string, unknown>,
  options: {
    mcpMethod?: string
    mcpName?: string
    version?: string
    token?: string
    origin?: string
    sessionId?: string
    headers?: Record<string, string>
  } = {},
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    'mcp-method': options.mcpMethod ?? method,
    'mcp-protocol-version': options.version ?? MCP_2026_PROTOCOL_VERSION,
  })
  if (options.mcpName) headers.set('mcp-name', options.mcpName)
  if (options.token) headers.set('authorization', `Bearer ${options.token}`)
  if (options.origin) headers.set('origin', options.origin)
  if (options.sessionId) headers.set('mcp-session-id', options.sessionId)
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers.set(name, value)
  }
  return new Request('http://127.0.0.1:8976/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(
      rpc(method, {
        ...params,
        _meta: meta(),
      }),
    ),
  })
}

async function json(response: Response): Promise<any> {
  return await response.json()
}

describe('MCP 2026 stateless runtime', () => {
  test('discovers extensions and emits cacheable tool lists per request', async () => {
    const runtime = new Mcp2026Runtime({
      cwd: cwd(),
      version: '1.47.0',
      backend: backend(),
    })
    const discovery = await runtime.handle(rpc('server/discover'), context())
    expect(discovery.result?.supportedVersions).toEqual([
      MCP_2026_PROTOCOL_VERSION,
    ])
    expect(
      (discovery.result?.capabilities as any).extensions[MCP_TASKS_EXTENSION],
    ).toEqual({})
    expect(
      (discovery.result?.capabilities as any).extensions[MCP_APPS_EXTENSION]
        .mimeTypes,
    ).toEqual([MCP_APP_MIME_TYPE])

    const withApps = await runtime.handle(rpc('tools/list'), context())
    expect(withApps.result?.ttlMs).toBe(300_000)
    expect(withApps.result?.cacheScope).toBe('private')
    const appTool = (withApps.result?.tools as any[]).find(
      tool => tool.name === UR_MCP_OVERVIEW_TOOL,
    )
    expect(appTool._meta.ui.resourceUri).toBe(UR_MCP_APP_URI)
    expect(
      (withApps.result?.tools as any[]).some(
        tool => tool.name === UR_MCP_ASYNC_TOOL,
      ),
    ).toBe(true)

    const withoutApps = await runtime.handle(
      rpc('tools/list'),
      context('owner', noCapabilities),
    )
    const fallbackTool = (withoutApps.result?.tools as any[]).find(
      tool => tool.name === UR_MCP_OVERVIEW_TOOL,
    )
    expect(fallbackTool._meta).toBeUndefined()
  })

  test('serves a self-contained, least-privilege MCP App resource', async () => {
    const runtime = new Mcp2026Runtime({
      cwd: cwd(),
      version: '1.47.0',
      backend: backend(),
    })
    const listed = await runtime.handle(rpc('resources/list'), context())
    expect((listed.result?.resources as any[])[0].uri).toBe(UR_MCP_APP_URI)
    const read = await runtime.handle(
      rpc('resources/read', { uri: UR_MCP_APP_URI }),
      context(),
    )
    const content = (read.result?.contents as any[])[0]
    expect(content.mimeType).toBe(MCP_APP_MIME_TYPE)
    expect(content._meta.ui.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
    })
    expect(content._meta.ui.permissions).toEqual({})
    expect(content.text).toContain("method:'ui/initialize'")
    expect(urMcpAppHtml()).not.toContain('<script src=')

    const denied = await runtime.handle(
      rpc('resources/read', { uri: UR_MCP_APP_URI }),
      context('owner', noCapabilities),
    )
    expect(denied.error?.code).toBe(-32003)
  })

  test('creates durable extension tasks, isolates owners, and completes', async () => {
    const directory = cwd()
    const runtime = new Mcp2026Runtime({
      cwd: directory,
      version: '1.47.0',
      backend: backend(async (_name, args) => ({
        content: [{ type: 'text', text: String(args.value) }],
        structuredContent: { value: args.value },
      })),
    })
    const created = await runtime.handle(
      rpc('tools/call', {
        name: UR_MCP_ASYNC_TOOL,
        arguments: {
          toolName: 'echo',
          arguments: { value: 'durable' },
          ttlMs: 60_000,
        },
      }),
      context('alice'),
    )
    expect(created.result?.resultType).toBe('task')
    expect(created.result?.status).toBe('working')
    const taskId = created.result?.taskId as string

    const hidden = await runtime.handle(
      rpc('tasks/get', { taskId }),
      context('bob'),
    )
    expect(hidden.error?.code).toBe(-32602)

    let completed: any
    for (let attempt = 0; attempt < 20; attempt++) {
      completed = await runtime.handle(
        rpc('tasks/get', { taskId }),
        context('alice'),
      )
      if (completed.result?.status === 'completed') break
      await Bun.sleep(2)
    }
    expect(completed.result.status).toBe('completed')
    expect(completed.result.result.structuredContent.value).toBe('durable')
    expect(completed.result.result.resultType).toBeUndefined()
    expect(
      statSync(join(directory, '.ur', 'mcp-2026', 'tasks.json')).mode & 0o777,
    ).toBe(0o600)

    const reloaded = new Mcp2026Runtime({
      cwd: directory,
      version: '1.47.0',
      backend: backend(),
    })
    const persisted = await reloaded.handle(
      rpc('tasks/get', { taskId }),
      context('alice'),
    )
    expect(persisted.result?.status).toBe('completed')
  })

  test('requires task capability and makes cancellation cooperative', async () => {
    let aborted = false
    const runtime = new Mcp2026Runtime({
      cwd: cwd(),
      version: '1.47.0',
      backend: backend(
        async (_name, _args, signal) =>
          await new Promise(resolve => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true
                resolve({ content: [{ type: 'text', text: 'cancelled' }] })
              },
              { once: true },
            )
          }),
      ),
    })
    const missingCapability = await runtime.handle(
      rpc('tools/call', {
        name: UR_MCP_ASYNC_TOOL,
        arguments: { toolName: 'echo', arguments: {} },
      }),
      context('owner', noCapabilities),
    )
    expect(missingCapability.error?.code).toBe(-32003)

    const created = await runtime.handle(
      rpc('tools/call', {
        name: UR_MCP_ASYNC_TOOL,
        arguments: { toolName: 'echo', arguments: {} },
      }),
      context(),
    )
    const taskId = created.result?.taskId as string
    const missingReadCapability = await runtime.handle(
      rpc('tasks/get', { taskId }),
      context('owner', noCapabilities),
    )
    expect(missingReadCapability.error?.code).toBe(-32003)
    const cancel = await runtime.handle(
      rpc('tasks/cancel', { taskId }),
      context(),
    )
    expect(cancel.result).toEqual({ resultType: 'complete' })
    expect(aborted).toBe(true)
    const fetched = await runtime.handle(
      rpc('tasks/get', { taskId }),
      context(),
    )
    expect(fetched.result?.status).toBe('cancelled')
  })

  test('treats isError tool results as completed task results', async () => {
    const runtime = new Mcp2026Runtime({
      cwd: cwd(),
      version: '1.47.0',
      backend: backend(async () => ({
        content: [{ type: 'text', text: 'invalid input' }],
        isError: true,
      })),
    })
    const created = await runtime.handle(
      rpc('tools/call', {
        name: UR_MCP_ASYNC_TOOL,
        arguments: { toolName: 'echo', arguments: {} },
      }),
      context(),
    )
    const taskId = created.result?.taskId as string
    let fetched: any
    for (let attempt = 0; attempt < 20; attempt++) {
      fetched = await runtime.handle(
        rpc('tasks/get', { taskId }),
        context(),
      )
      if (fetched.result?.status === 'completed') break
      await Bun.sleep(2)
    }
    expect(fetched.result?.status).toBe('completed')
    expect(fetched.result?.result.isError).toBe(true)
    expect(fetched.result?.error).toBeUndefined()
  })

  test('rejects removed handshake methods', async () => {
    const runtime = new Mcp2026Runtime({
      cwd: cwd(),
      version: '1.47.0',
      backend: backend(),
    })
    const initialized = await runtime.handle(rpc('initialize'), context())
    expect(initialized.error?.code).toBe(-32601)
    expect(initialized.error?.message).toContain('removed')
  })

  test('quarantines corrupt durable task state instead of trusting or deleting it', () => {
    const directory = cwd()
    const stateDir = join(directory, '.ur', 'mcp-2026')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, 'tasks.json'), '{not-json', { mode: 0o600 })

    new Mcp2026Runtime({
      cwd: directory,
      version: '1.47.0',
      backend: backend(),
    })

    expect(existsSync(join(stateDir, 'tasks.json'))).toBe(false)
    const quarantined = readdirSync(stateDir).find(name =>
      name.startsWith('tasks.json.corrupt.'),
    )
    expect(quarantined).toBeDefined()
    expect(statSync(join(stateDir, quarantined!)).mode & 0o077).toBe(0)
  })
})

describe('MCP 2026 HTTP transport', () => {
  test('requires self-contained version/capability metadata and routing headers', async () => {
    const runtime = new Mcp2026Runtime({
      cwd: cwd(),
      version: '1.47.0',
      backend: backend(),
    })
    const handler = createMcp2026HttpHandler(runtime, {})
    const discovery = await handler(httpRequest('server/discover', {}))
    expect(discovery.status).toBe(200)
    expect(discovery.headers.get('mcp-session-id')).toBeNull()
    expect((await json(discovery)).result.resultType).toBe('complete')

    const mismatch = await handler(
      httpRequest('tools/list', {}, { mcpMethod: 'resources/list' }),
    )
    expect(mismatch.status).toBe(400)
    expect((await json(mismatch)).error.code).toBe(-32001)

    const unsupported = await handler(
      httpRequest('tools/list', {}, { version: '2099-01-01' }),
    )
    const unsupportedBody = await json(unsupported)
    expect(unsupported.status).toBe(400)
    expect(unsupportedBody.error.code).toBe(-32004)
    expect(unsupportedBody.error.data.supported).toEqual([
      MCP_2026_PROTOCOL_VERSION,
    ])

    const legacySession = await handler(
      httpRequest('tools/list', {}, { sessionId: 'legacy-session' }),
    )
    expect((await json(legacySession)).error.code).toBe(-32001)

    const created = await runtime.handle(
      rpc('tools/call', {
        name: UR_MCP_ASYNC_TOOL,
        arguments: { toolName: 'echo', arguments: {} },
      }),
      context('local'),
    )
    const taskId = created.result?.taskId as string
    const missingTaskName = await handler(
      httpRequest('tasks/get', { taskId }),
    )
    expect(missingTaskName.status).toBe(400)
    expect((await json(missingTaskName)).error.code).toBe(-32001)
    const routedTask = await handler(
      httpRequest('tasks/get', { taskId }, { mcpName: taskId }),
    )
    expect(routedTask.status).toBe(200)
  })

  test('validates Mcp-Name, bearer auth, and CORS before tool execution', async () => {
    let calls = 0
    const runtime = new Mcp2026Runtime({
      cwd: cwd(),
      version: '1.47.0',
      backend: backend(async () => {
        calls++
        return { content: [{ type: 'text', text: 'ok' }] }
      }),
    })
    const handler = createMcp2026HttpHandler(runtime, {
      token: 'server-token',
      allowedOrigins: ['https://allowed.example'],
    })
    const deniedOrigin = await handler(
      httpRequest(
        'tools/call',
        { name: 'echo', arguments: {} },
        {
          mcpName: 'echo',
          token: 'server-token',
          origin: 'https://denied.example',
        },
      ),
    )
    expect(deniedOrigin.status).toBe(403)
    expect(calls).toBe(0)

    const unauthorized = await handler(
      httpRequest('tools/call', { name: 'echo', arguments: {} }, {
        mcpName: 'echo',
      }),
    )
    expect(unauthorized.status).toBe(401)

    const nameMismatch = await handler(
      httpRequest(
        'tools/call',
        { name: 'echo', arguments: {} },
        {
          mcpName: 'other',
          token: 'server-token',
          origin: 'https://allowed.example',
        },
      ),
    )
    expect((await json(nameMismatch)).error.code).toBe(-32001)

    const allowed = await handler(
      httpRequest(
        'tools/call',
        { name: 'echo', arguments: { value: 'ok' } },
        {
          mcpName: 'echo',
          token: 'server-token',
          origin: 'https://allowed.example',
        },
      ),
    )
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'https://allowed.example',
    )
    expect(calls).toBe(1)
  })

  test('validates nested x-mcp-header values before tool execution', async () => {
    let calls = 0
    const runtime = new Mcp2026Runtime({
      cwd: cwd(),
      version: '1.47.0',
      backend: {
        listTools: async () => ({
          tools: [
            {
              name: 'route',
              inputSchema: {
                type: 'object',
                properties: {
                  routing: {
                    type: 'object',
                    properties: {
                      region: {
                        type: 'string',
                        'x-mcp-header': 'Region',
                      },
                      shard: {
                        type: 'integer',
                        'x-mcp-header': 'Shard',
                      },
                    },
                  },
                },
              },
            },
          ],
        }),
        callTool: async () => {
          calls++
          return { content: [{ type: 'text', text: 'routed' }] }
        },
      },
    })
    const handler = createMcp2026HttpHandler(runtime, {})
    const params = {
      name: 'route',
      arguments: { routing: { region: '日本語', shard: 42 } },
    }

    const missing = await handler(
      httpRequest('tools/call', params, { mcpName: 'route' }),
    )
    expect(missing.status).toBe(400)
    expect((await json(missing)).error.code).toBe(-32001)
    expect(calls).toBe(0)

    const malformed = await handler(
      httpRequest('tools/call', params, {
        mcpName: 'route',
        headers: {
          'mcp-param-region': '=?base64?not-valid!?=',
          'mcp-param-shard': '42',
        },
      }),
    )
    expect((await json(malformed)).error.code).toBe(-32001)
    expect(calls).toBe(0)

    const valid = await handler(
      httpRequest('tools/call', params, {
        mcpName: 'route',
        headers: {
          'mcp-param-region': '=?base64?5pel5pys6Kqe?=',
          'mcp-param-shard': '42',
        },
      }),
    )
    expect(valid.status).toBe(200)
    expect(calls).toBe(1)

    const extra = await handler(
      httpRequest(
        'tools/call',
        { name: 'route', arguments: { routing: { region: null } } },
        {
          mcpName: 'route',
          headers: { 'mcp-param-region': 'null' },
        },
      ),
    )
    expect((await json(extra)).error.code).toBe(-32001)
    expect(calls).toBe(1)
  })

  test('resolves local JSON Schema references for x-mcp-header bindings', async () => {
    const runtime = new Mcp2026Runtime({
      cwd: cwd(),
      version: '1.47.0',
      backend: {
        listTools: async () => ({
          tools: [
            {
              name: 'referenced-route',
              inputSchema: {
                type: 'object',
                properties: {
                  routing: { $ref: '#/$defs/routing' },
                },
                $defs: {
                  routing: {
                    type: 'object',
                    properties: {
                      region: {
                        type: 'string',
                        'x-mcp-header': 'Region',
                      },
                    },
                  },
                },
              },
            },
          ],
        }),
        callTool: async () => ({ content: [] }),
      },
    })
    const headers = new Headers({ 'mcp-param-region': 'eu-central-1' })
    await expect(
      runtime.validateToolHeaders(
        'referenced-route',
        { routing: { region: 'eu-central-1' } },
        headers,
        allCapabilities,
      ),
    ).resolves.toBeUndefined()
    await expect(
      runtime.validateToolHeaders(
        'referenced-route',
        { routing: { region: 'us-east-1' } },
        headers,
        allCapabilities,
      ),
    ).rejects.toThrow('does not match')
  })
})
