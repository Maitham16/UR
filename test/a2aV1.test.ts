import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { A2AProtocolRuntime } from '../src/services/agents/a2aProtocol.js'
import {
  A2AV1ProtocolRuntime,
  namespaceA2AV1Identity,
} from '../src/services/agents/a2aV1.js'
import { handleA2ARequest } from '../src/services/agents/a2aServer.js'
import { mintDelegationToken } from '../src/services/agents/delegation.js'
import {
  buildA2AAgentCard,
  buildA2AV1AgentCard,
} from '../src/services/agents/trends.js'

const baseUrl = 'http://127.0.0.1:8765'

const identity = {
  isAuthenticated: true,
  userName: 'a2a-v1-test',
  scopes: ['*'],
  requestedSkill: 'coding-agent',
}

function cwd(): string {
  return mkdtempSync(join(tmpdir(), 'ur-a2a-v1-'))
}

function runtime(directory = cwd()): A2AV1ProtocolRuntime {
  return new A2AV1ProtocolRuntime(
    new A2AProtocolRuntime({
      cwd: directory,
      card: buildA2AAgentCard({ baseUrl }),
      dryRun: true,
    }),
  )
}

function message(id: string, prompt: string, tenant?: string) {
  return {
    ...(tenant ? { tenant } : {}),
    metadata: { skill: 'coding-agent' },
    message: {
      messageId: `message-${id}`,
      role: 'ROLE_USER',
      parts: [{ text: prompt }],
    },
  }
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return new Request(`${baseUrl}${path}`, { ...init, headers })
}

async function json(response: Response): Promise<any> {
  return await response.json()
}

describe('A2A v1 compatibility runtime', () => {
  test('uses v1 ProtoJSON shapes and PascalCase lifecycle methods', async () => {
    const adapter = runtime()
    const sent = await adapter.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 'send',
        method: 'SendMessage',
        params: message('one', 'review this patch'),
      },
      identity,
    )
    const task = (sent.result as { task: any }).task
    expect(sent.error).toBeUndefined()
    expect(task.kind).toBeUndefined()
    expect(task.status.state).toBe('TASK_STATE_COMPLETED')
    expect(task.status.message.kind).toBeUndefined()
    expect(task.status.message.role).toBe('ROLE_AGENT')
    expect(task.status.message.parts[0].text).toContain('"dryRun":true')

    const fetched = await adapter.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 'get',
        method: 'GetTask',
        params: { id: task.id, historyLength: 10 },
      },
      identity,
    )
    expect((fetched.result as any).id).toBe(task.id)
    expect((fetched.result as any).history[0].role).toBe('ROLE_USER')
  })

  test('paginates ListTasks with filter-bound cursors and isolates tenants', async () => {
    const adapter = runtime()
    for (const id of ['one', 'two', 'three']) {
      const response = await adapter.sendMessage(
        message(id, `task ${id}`, 'tenant-a'),
        identity,
      )
      expect('task' in response).toBe(true)
    }

    const first = await adapter.listTasks(
      { tenant: 'tenant-a', pageSize: 2, includeArtifacts: false },
      identity,
    )
    expect(first.tasks).toHaveLength(2)
    expect(first.totalSize).toBe(3)
    expect(first.nextPageToken.length).toBeGreaterThan(0)
    expect(first.tasks[0]?.artifacts).toBeUndefined()

    const second = await adapter.listTasks(
      {
        tenant: 'tenant-a',
        pageSize: 2,
        pageToken: first.nextPageToken,
        includeArtifacts: false,
      },
      identity,
    )
    expect(second.tasks).toHaveLength(1)
    expect(second.nextPageToken).toBe('')

    const hidden = await adapter.getTask(
      { id: first.tasks[0]!.id, tenant: 'tenant-b' },
      identity,
    ).catch(error => error)
    expect(hidden).toBeInstanceOf(Error)

    await expect(
      adapter.listTasks(
        {
          tenant: 'tenant-a',
          pageSize: 2,
          pageToken: first.nextPageToken,
          status: 'TASK_STATE_FAILED',
          includeArtifacts: false,
        },
        identity,
      ),
    ).rejects.toThrow('pageToken')
  })

  test('rejects ambiguous parts and unknown operations deterministically', async () => {
    const adapter = runtime()
    const invalid = await adapter.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 'invalid-part',
        method: 'SendMessage',
        params: {
          message: {
            messageId: 'ambiguous',
            role: 'ROLE_USER',
            parts: [{ text: 'one', data: { two: true } }],
          },
        },
      },
      identity,
    )
    expect(invalid.error?.code).toBe(-32602)

    const streaming = await adapter.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 'stream',
        method: 'SendStreamingMessage',
        params: message('stream', 'stream this'),
      },
      identity,
    )
    expect(streaming.error?.code).toBe(-32004)
  })

  test('namespaces identities only when a tenant is present', () => {
    expect(namespaceA2AV1Identity(identity, '').userName).toBe(identity.userName)
    expect(namespaceA2AV1Identity(identity, 'one').userName).not.toBe(
      namespaceA2AV1Identity(identity, 'two').userName,
    )
  })
})

describe('A2A v1 HTTP bindings', () => {
  test('negotiates separate strict v0.3 and v1 Agent Cards', async () => {
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: cwd(),
      dryRun: true,
      token: 'server-token',
    }
    const legacyResponse = await handleA2ARequest(
      request('/.well-known/agent-card.json', {
        headers: { 'a2a-version': '0.3' },
      }),
      options,
      baseUrl,
    )
    const legacy = await json(legacyResponse)
    expect(legacyResponse.headers.get('a2a-version')).toBe('0.3')
    expect(legacy.protocolVersion).toBe('0.3.0')
    expect(legacy.supportedInterfaces).toBeUndefined()

    const v1Response = await handleA2ARequest(
      request('/.well-known/agent-card.json'),
      options,
      baseUrl,
    )
    const card = await json(v1Response)
    expect(v1Response.headers.get('vary')).toBe('A2A-Version')
    expect(card.protocolVersion).toBeUndefined()
    expect(card.supportedInterfaces).toEqual(
      buildA2AV1AgentCard({ baseUrl, staticBearer: true }).supportedInterfaces,
    )
    expect(card.securitySchemes.bearer.httpAuthSecurityScheme.scheme).toBe(
      'Bearer',
    )
    expect(card.securityRequirements).toEqual([{ schemes: { bearer: [] } }])
  })

  test('serves JSON-RPC and HTTP+JSON v1 task lifecycles', async () => {
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: cwd(),
      dryRun: true,
      token: 'server-token',
    }
    const headers = {
      authorization: 'Bearer server-token',
      'a2a-version': '1.0',
    }
    const rpcSend = await handleA2ARequest(
      request('/a2a/v1/jsonrpc', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'send',
          method: 'SendMessage',
          params: message('rpc', 'rpc task'),
        }),
      }),
      options,
      baseUrl,
    )
    expect(rpcSend.headers.get('a2a-version')).toBe('1.0')
    const rpcTask = (await json(rpcSend)).result.task
    expect(rpcTask.status.state).toBe('TASK_STATE_COMPLETED')

    const restSend = await handleA2ARequest(
      request('/a2a/v1/message:send', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/a2a+json' },
        body: JSON.stringify(message('rest', 'rest task')),
      }),
      options,
      baseUrl,
    )
    expect(restSend.headers.get('content-type')).toBe('application/json')
    const restTask = (await json(restSend)).task
    expect(restTask.status.state).toBe('TASK_STATE_COMPLETED')

    const listed = await handleA2ARequest(
      request('/a2a/v1/tasks?pageSize=1&includeArtifacts=false', {
        headers,
      }),
      options,
      baseUrl,
    )
    const page = await json(listed)
    expect(page.tasks).toHaveLength(1)
    expect(page.totalSize).toBe(2)

    const fetched = await handleA2ARequest(
      request(`/a2a/v1/tasks/${encodeURIComponent(restTask.id)}?historyLength=1`, {
        headers,
      }),
      options,
      baseUrl,
    )
    expect((await json(fetched)).id).toBe(restTask.id)
  })

  test('enforces v1 media type, version, and tenant delegation boundaries', async () => {
    const directory = cwd()
    const secret = 'a2a-v1-delegation-secret'
    const tenantToken = mintDelegationToken(secret, {
      subject: 'tenant-client',
      audience: 'ur-nexus',
      scope: ['coding-agent', 'tenant:alpha'],
    })
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: directory,
      dryRun: true,
      delegationSecret: secret,
      audience: 'ur-nexus',
    }
    const noVersion = await handleA2ARequest(
      request('/a2a/v1/jsonrpc', {
        method: 'POST',
        headers: { authorization: `Bearer ${tenantToken}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'version',
          method: 'SendMessage',
          params: message('version', 'version task'),
        }),
      }),
      options,
      baseUrl,
    )
    expect((await json(noVersion)).error.code).toBe(-32009)

    const wrongMedia = await handleA2ARequest(
      request('/a2a/v1/jsonrpc', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tenantToken}`,
          'a2a-version': '1.0',
          'content-type': 'text/plain',
        },
        body: '{}',
      }),
      options,
      baseUrl,
    )
    expect(wrongMedia.status).toBe(415)
    expect((await json(wrongMedia)).error.code).toBe(-32005)

    const allowed = await handleA2ARequest(
      request('/a2a/v1/alpha/message:send', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tenantToken}`,
          'a2a-version': '1.0',
        },
        body: JSON.stringify(message('alpha', 'tenant task')),
      }),
      options,
      baseUrl,
    )
    expect(allowed.status).toBe(200)

    const denied = await handleA2ARequest(
      request('/a2a/v1/beta/message:send', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tenantToken}`,
          'a2a-version': '1.0',
        },
        body: JSON.stringify(message('beta', 'other tenant task')),
      }),
      options,
      baseUrl,
    )
    expect(denied.status).toBe(403)
    expect((await json(denied)).error.status).toBe('PERMISSION_DENIED')
  })

  test('supports transport-root aliases and maps empty cancel requests to AIP errors', async () => {
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: cwd(),
      dryRun: true,
    }
    const headers = { 'a2a-version': '1.0' }
    const rootSend = await handleA2ARequest(
      request('/', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'root-send',
          method: 'SendMessage',
          params: message('root', 'root task'),
        }),
      }),
      options,
      baseUrl,
    )
    expect((await json(rootSend)).result.task.status.state).toBe(
      'TASK_STATE_COMPLETED',
    )

    const missingCancel = await handleA2ARequest(
      request('/tasks/not-present:cancel', {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        body: '',
      }),
      options,
      baseUrl,
    )
    expect(missingCancel.status).toBe(404)
    const problem = await json(missingCancel)
    expect(problem.error.status).toBe('NOT_FOUND')
    expect(problem.error.details[0].reason).toBe('TASK_NOT_FOUND')
  })
})
