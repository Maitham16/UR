import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { authorizeRequest, handleA2ARequest } from '../src/services/agents/a2aServer.js'
import {
  attenuateDelegationToken,
  isScopeSubset,
  mintDelegationToken,
  scopeAllows,
  verifyDelegationToken,
} from '../src/services/agents/delegation.js'

const SECRET = 'test-secret-key'

describe('delegation tokens', () => {
  test('mint then verify round-trips with audience and scope', () => {
    const token = mintDelegationToken(SECRET, {
      subject: 'ur-cli',
      audience: 'ur-nexus',
      scope: ['coding-agent'],
      ttlSeconds: 3600,
    })
    expect(token.split('.')).toHaveLength(2)
    const result = verifyDelegationToken(SECRET, token, {
      audience: 'ur-nexus',
      requiredScope: 'coding-agent',
    })
    expect(result.valid).toBe(true)
    expect(result.claims?.sub).toBe('ur-cli')
  })

  test('rejects an expired token', () => {
    const token = mintDelegationToken(SECRET, {
      subject: 's',
      audience: 'ur-nexus',
      ttlSeconds: 100,
      now: 1000,
    })
    expect(verifyDelegationToken(SECRET, token, { now: 1050 }).valid).toBe(true)
    const expired = verifyDelegationToken(SECRET, token, { now: 1100 })
    expect(expired.valid).toBe(false)
    expect(expired.reason).toBe('token expired')
  })

  test('rejects an audience mismatch', () => {
    const token = mintDelegationToken(SECRET, { subject: 's', audience: 'ur-nexus' })
    const result = verifyDelegationToken(SECRET, token, { audience: 'other-agent' })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('audience mismatch')
  })

  test('accepts legacy audience aliases when explicitly configured', () => {
    const token = mintDelegationToken(SECRET, { subject: 's', audience: 'ur-agent' })
    const result = verifyDelegationToken(SECRET, token, {
      audience: 'ur-nexus',
      audienceAliases: ['ur-agent'],
    })
    expect(result.valid).toBe(true)
  })

  test('enforces scope, and * grants every skill', () => {
    const scoped = mintDelegationToken(SECRET, {
      subject: 's',
      audience: 'ur-nexus',
      scope: ['coding-agent'],
    })
    expect(verifyDelegationToken(SECRET, scoped, { requiredScope: 'coding-agent' }).valid).toBe(true)
    const denied = verifyDelegationToken(SECRET, scoped, { requiredScope: 'browser-agent' })
    expect(denied.valid).toBe(false)
    expect(denied.reason).toContain('not granted')

    const wildcard = mintDelegationToken(SECRET, { subject: 's', audience: 'ur-nexus' })
    expect(verifyDelegationToken(SECRET, wildcard, { requiredScope: 'anything' }).valid).toBe(true)
  })

  test('detects tampering and a wrong secret', () => {
    const token = mintDelegationToken(SECRET, { subject: 's', audience: 'ur-nexus' })
    expect(verifyDelegationToken('wrong-secret', token).valid).toBe(false)
    const [payload, sig] = token.split('.')
    const tampered = `${payload}x.${sig}`
    expect(verifyDelegationToken(SECRET, tampered, {}).reason).toBe('bad signature')
    expect(verifyDelegationToken(SECRET, 'not-a-token', {}).reason).toBe('malformed token')
  })

  test('scope helpers', () => {
    expect(scopeAllows(['*'], 'x')).toBe(true)
    expect(scopeAllows(['a'], 'b')).toBe(false)
    expect(isScopeSubset(['a'], ['a', 'b'])).toBe(true)
    expect(isScopeSubset(['*'], ['a'])).toBe(false)
    expect(isScopeSubset(['a'], ['*'])).toBe(true)
  })
})

describe('issuer-side delegation narrowing', () => {
  test('narrows scope and never outlives the parent', () => {
    const parentToken = mintDelegationToken(SECRET, {
      subject: 'root',
      audience: 'ur-nexus',
      scope: ['coding-agent', 'research-agent'],
      ttlSeconds: 3600,
      now: 1000,
    })
    const parent = verifyDelegationToken(SECRET, parentToken, { now: 1000 }).claims!

    const child = attenuateDelegationToken(SECRET, parent, {
      scope: ['coding-agent'],
      ttlSeconds: 99999, // clamped to parent's remaining lifetime
      now: 1000,
    })
    expect(child.token).toBeDefined()
    const childClaims = verifyDelegationToken(SECRET, child.token!, { now: 1000 }).claims!
    expect(childClaims.scope).toEqual(['coding-agent'])
    expect(childClaims.exp).toBeLessThanOrEqual(parent.exp)
    // The child cannot reach a skill the parent dropped.
    expect(
      verifyDelegationToken(SECRET, child.token!, { requiredScope: 'research-agent', now: 1000 })
        .valid,
    ).toBe(false)
  })

  test('cannot widen scope beyond the parent', () => {
    const parentToken = mintDelegationToken(SECRET, {
      subject: 'root',
      audience: 'ur-nexus',
      scope: ['coding-agent'],
      now: 1000,
    })
    const parent = verifyDelegationToken(SECRET, parentToken, { now: 1000 }).claims!
    const widened = attenuateDelegationToken(SECRET, parent, { scope: ['*'], now: 1000 })
    expect(widened.token).toBeUndefined()
    expect(widened.error).toContain('subset')
  })
})

describe('a2a server authorization', () => {
  const post = (auth?: string): Request =>
    new Request('http://127.0.0.1:8765/a2a/tasks', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
    })

  test('is open when neither a token nor a delegation secret is set', () => {
    expect(authorizeRequest(post(), {}).ok).toBe(true)
  })

  test('accepts the static bearer token and rejects a wrong one', () => {
    expect(authorizeRequest(post('Bearer s3cret'), { token: 's3cret' }).ok).toBe(true)
    expect(authorizeRequest(post('Bearer nope'), { token: 's3cret' }).ok).toBe(false)
    expect(authorizeRequest(post(), { token: 's3cret' }).reason).toBe('missing bearer token')
  })

  test('accepts a valid delegation token and enforces its scope', () => {
    const token = mintDelegationToken(SECRET, {
      subject: 'peer',
      audience: 'ur-nexus',
      scope: ['coding-agent'],
    })
    const options = { delegationSecret: SECRET, audience: 'ur-nexus' }
    expect(authorizeRequest(post(`Bearer ${token}`), options, 'coding-agent').ok).toBe(true)
    const denied = authorizeRequest(post(`Bearer ${token}`), options, 'browser-agent')
    expect(denied.ok).toBe(false)
    expect(denied.reason).toContain('not granted')
  })

  test('accepts legacy ur-agent audience for the default UR-Nexus server audience', () => {
    const token = mintDelegationToken(SECRET, {
      subject: 'peer',
      audience: 'ur-agent',
      scope: ['coding-agent'],
    })
    expect(
      authorizeRequest(
        post(`Bearer ${token}`),
        { delegationSecret: SECRET, audience: 'UR' },
        'coding-agent',
      ).ok,
    ).toBe(true)
    expect(
      authorizeRequest(
        post(`Bearer ${token}`),
        { delegationSecret: SECRET, audience: 'custom-agent' },
        'coding-agent',
      ).ok,
    ).toBe(false)
  })
})

describe('a2a task server lifecycle', () => {
  const cwd = (): string => mkdtempSync(join(tmpdir(), 'ur-a2a-'))
  const request = (path: string, init?: RequestInit): Request => {
    const headers = new Headers(init?.headers)
    if (init?.body != null && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    return new Request(`http://127.0.0.1:8765${path}`, {
      ...init,
      headers,
    })
  }

  async function json(response: Response): Promise<any> {
    return await response.json()
  }

  const protocolMessage = (id: string, prompt: string, skill = 'coding-agent') => ({
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      configuration: { blocking: true },
      metadata: { skill },
      message: {
        kind: 'message',
        messageId: `message-${id}`,
        role: 'user',
        parts: [{ kind: 'text', text: prompt }],
      },
    },
  })

  test('serves an accurate Agent Card and official-SDK A2A v0.3 JSON-RPC lifecycle', async () => {
    const dir = cwd()
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: dir,
      dryRun: true,
      token: 'server-token',
    }
    const baseUrl = 'http://127.0.0.1:8765'
    const cardResponse = await handleA2ARequest(
      request('/.well-known/agent-card.json'),
      options,
      baseUrl,
    )
    const card = await json(cardResponse)
    expect(card.protocolVersion).toBe('0.3.0')
    expect(card.url).toBe(`${baseUrl}/a2a/jsonrpc`)
    expect(card.preferredTransport).toBe('JSONRPC')
    expect(card.security).toEqual([{ bearer: [] }])
    expect(card.securitySchemes.delegation).toBeUndefined()

    const send = await handleA2ARequest(
      request('/a2a/jsonrpc', {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'a2a-version': '0.3',
        },
        body: JSON.stringify(protocolMessage('send-1', 'review this patch')),
      }),
      options,
      baseUrl,
    )
    expect(send.status).toBe(200)
    expect(send.headers.get('a2a-version')).toBe('0.3')
    const sent = await json(send)
    expect(sent.error).toBeUndefined()
    expect(sent.result.kind).toBe('task')
    expect(sent.result.status.state).toBe('completed')
    expect(sent.result.status.message.parts[0].text).toContain('"dryRun":true')

    const get = await handleA2ARequest(
      request('/a2a/jsonrpc', {
        method: 'POST',
        headers: { authorization: 'Bearer server-token' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-1',
          method: 'tasks/get',
          params: { id: sent.result.id, historyLength: 10 },
        }),
      }),
      options,
      baseUrl,
    )
    const fetched = await json(get)
    expect(fetched.result.id).toBe(sent.result.id)
    expect(fetched.result.history.length).toBeGreaterThan(0)
  })

  test('enforces the A2A JSON-RPC HTTP binding', async () => {
    const dir = cwd()
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: dir,
      dryRun: true,
    }
    const baseUrl = 'http://127.0.0.1:8765'

    const wrongMethod = await handleA2ARequest(
      request('/a2a/jsonrpc'),
      options,
      baseUrl,
    )
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST')

    const wrongMediaType = await handleA2ARequest(
      request('/a2a/jsonrpc', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(protocolMessage('bad-media', 'review this')),
      }),
      options,
      baseUrl,
    )
    expect(wrongMediaType.status).toBe(415)
    expect((await json(wrongMediaType)).error.code).toBe(-32600)
  })

  test('accepts advertised structured JSON input as an A2A data part', async () => {
    const dir = cwd()
    const response = await handleA2ARequest(
      request('/a2a/jsonrpc', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'data-part',
          method: 'message/send',
          params: {
            configuration: { blocking: true },
            message: {
              kind: 'message',
              messageId: 'data-message',
              role: 'user',
              parts: [{ kind: 'data', data: { task: 'review', strict: true } }],
            },
          },
        }),
      }),
      { host: '127.0.0.1', port: 8765, cwd: dir, dryRun: true },
      'http://127.0.0.1:8765',
    )
    expect(response.status).toBe(200)
    expect((await json(response)).result.status.state).toBe('completed')
  })

  test('isolates A2A protocol tasks by delegation subject', async () => {
    const dir = cwd()
    const tokenFor = (subject: string) =>
      mintDelegationToken(SECRET, {
        subject,
        audience: 'ur-nexus',
        scope: ['coding-agent'],
      })
    const alice = tokenFor('protocol-alice')
    const bob = tokenFor('protocol-bob')
    const aliceWrongScope = mintDelegationToken(SECRET, {
      subject: 'protocol-alice',
      audience: 'ur-nexus',
      scope: ['research-agent'],
    })
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: dir,
      dryRun: true,
      delegationSecret: SECRET,
      audience: 'ur-nexus',
    }
    const baseUrl = 'http://127.0.0.1:8765'
    const send = await handleA2ARequest(
      request('/a2a/jsonrpc', {
        method: 'POST',
        headers: { authorization: `Bearer ${alice}` },
        body: JSON.stringify(protocolMessage('alice-send', 'private task')),
      }),
      options,
      baseUrl,
    )
    const sent = await json(send)

    const crossSubjectGet = await handleA2ARequest(
      request('/a2a/jsonrpc', {
        method: 'POST',
        headers: { authorization: `Bearer ${bob}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'bob-get',
          method: 'tasks/get',
          params: { id: sent.result.id },
        }),
      }),
      options,
      baseUrl,
    )
    const denied = await json(crossSubjectGet)
    expect(denied.error.code).toBe(-32001)

    const crossScopeGet = await handleA2ARequest(
      request('/a2a/jsonrpc', {
        method: 'POST',
        headers: { authorization: `Bearer ${aliceWrongScope}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'alice-wrong-scope-get',
          method: 'tasks/get',
          params: { id: sent.result.id },
        }),
      }),
      options,
      baseUrl,
    )
    expect((await json(crossScopeGet)).error.code).toBe(-32001)
  })

  test('submits an async task and exposes status, output metadata, and cancellation', async () => {
    const dir = cwd()
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: dir,
      dryRun: true,
    }
    const submit = await handleA2ARequest(
      request('/a2a/tasks', {
        method: 'POST',
        body: JSON.stringify({
          prompt: 'implement the local feature',
          skill: 'coding-agent',
          worktree: true,
          maxTurns: 2,
        }),
      }),
      options,
      'http://127.0.0.1:8765',
    )
    expect(submit.status).toBe(200)
    const submitted = await json(submit)
    expect(submitted.dryRun).toBe(true)
    expect(submitted.task.status).toBe('submitted')
    expect(submitted.command).toContain('bg')
    expect(submitted.statusUrl).toMatch(/^\/a2a\/tasks\//)

    const list = await handleA2ARequest(
      request('/a2a/tasks'),
      options,
      'http://127.0.0.1:8765',
    )
    expect(list.status).toBe(200)
    const listed = await json(list)
    expect(listed.tasks).toHaveLength(1)
    expect(listed.tasks[0].prompt).toBe('implement the local feature')

    const taskId = submitted.task.id as string
    const status = await handleA2ARequest(
      request(`/a2a/tasks/${taskId}`),
      options,
      'http://127.0.0.1:8765',
    )
    expect(status.status).toBe(200)
    expect((await json(status)).task.backgroundTaskId).toBeDefined()

    const output = await handleA2ARequest(
      request(`/a2a/tasks/${taskId}/output`),
      options,
      'http://127.0.0.1:8765',
    )
    expect(output.status).toBe(200)
    expect((await json(output)).outputFile).toContain('.ur/background/outputs')

    const canceled = await handleA2ARequest(
      request(`/a2a/tasks/${taskId}/cancel`, { method: 'POST' }),
      options,
      'http://127.0.0.1:8765',
    )
    expect(canceled.status).toBe(200)
    expect((await json(canceled)).task.status).toBe('canceled')
  })

  test('keeps sync dry-run behavior for trusted A2A callers', async () => {
    const dir = cwd()
    const response = await handleA2ARequest(
      request('/a2a/tasks', {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
        body: JSON.stringify({ prompt: 'summarize this repo', wait: true }),
      }),
      {
        host: '127.0.0.1',
        port: 8765,
        cwd: dir,
        dryRun: true,
        token: 'test-token',
      },
      'http://127.0.0.1:8765',
    )
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.command).toContain('-p')
    expect(body.task.mode).toBe('sync')
  })

  test('validates compatibility media types and task options', async () => {
    const dir = cwd()
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: dir,
      dryRun: true,
      token: 'operator-token',
    }
    const wrongMediaType = await handleA2ARequest(
      request('/a2a/tasks', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ prompt: 'review this' }),
      }),
      options,
      'http://127.0.0.1:8765',
    )
    expect(wrongMediaType.status).toBe(401)

    const invalidOption = await handleA2ARequest(
      request('/a2a/tasks', {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' },
        body: JSON.stringify({ prompt: 'review this', mode: 'sometimes' }),
      }),
      options,
      'http://127.0.0.1:8765',
    )
    expect(invalidOption.status).toBe(400)

    const authorizedWrongMediaType = await handleA2ARequest(
      request('/a2a/tasks', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'text/plain',
        },
        body: JSON.stringify({ prompt: 'review this' }),
      }),
      options,
      'http://127.0.0.1:8765',
    )
    expect(authorizedWrongMediaType.status).toBe(415)

    const privilegedSync = await handleA2ARequest(
      request('/a2a/tasks', {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' },
        body: JSON.stringify({
          prompt: 'review this',
          mode: 'sync',
          skipPermissions: true,
        }),
      }),
      options,
      'http://127.0.0.1:8765',
    )
    expect((await json(privilegedSync)).command).toContain(
      '--dangerously-skip-permissions',
    )
  })

  test('fails closed for omitted delegation scope and permission bypass', async () => {
    const dir = cwd()
    const researchOnly = mintDelegationToken(SECRET, {
      subject: 'research-peer',
      audience: 'ur-nexus',
      scope: ['research-agent'],
    })
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: dir,
      dryRun: true,
      delegationSecret: SECRET,
      audience: 'ur-nexus',
    }

    const missingSkill = await handleA2ARequest(
      request('/a2a/tasks', {
        method: 'POST',
        headers: { authorization: `Bearer ${researchOnly}` },
        body: JSON.stringify({ prompt: 'run arbitrary code' }),
      }),
      options,
      'http://127.0.0.1:8765',
    )
    expect(missingSkill.status).toBe(401)

    const localBypass = await handleA2ARequest(
      request('/a2a/tasks', {
        method: 'POST',
        body: JSON.stringify({
          prompt: 'run without checks',
          skipPermissions: true,
        }),
      }),
      { ...options, delegationSecret: undefined },
      'http://127.0.0.1:8765',
    )
    expect(localBypass.status).toBe(403)
  })

  test('isolates delegated task records by token subject and skill', async () => {
    const dir = cwd()
    const tokenFor = (subject: string) =>
      mintDelegationToken(SECRET, {
        subject,
        audience: 'ur-nexus',
        scope: ['coding-agent'],
      })
    const alice = tokenFor('alice')
    const bob = tokenFor('bob')
    const options = {
      host: '127.0.0.1',
      port: 8765,
      cwd: dir,
      dryRun: true,
      delegationSecret: SECRET,
      audience: 'ur-nexus',
    }

    const submit = await handleA2ARequest(
      request('/a2a/tasks', {
        method: 'POST',
        headers: { authorization: `Bearer ${alice}` },
        body: JSON.stringify({ prompt: 'review the patch' }),
      }),
      options,
      'http://127.0.0.1:8765',
    )
    expect(submit.status).toBe(200)

    const aliceList = await handleA2ARequest(
      request('/a2a/tasks', {
        headers: { authorization: `Bearer ${alice}` },
      }),
      options,
      'http://127.0.0.1:8765',
    )
    expect((await json(aliceList)).tasks).toHaveLength(1)

    const bobList = await handleA2ARequest(
      request('/a2a/tasks', {
        headers: { authorization: `Bearer ${bob}` },
      }),
      options,
      'http://127.0.0.1:8765',
    )
    expect((await json(bobList)).tasks).toHaveLength(0)
  })
})
