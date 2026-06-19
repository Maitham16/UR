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
      audience: 'ur-agent',
      scope: ['coding-agent'],
      ttlSeconds: 3600,
    })
    expect(token.split('.')).toHaveLength(2)
    const result = verifyDelegationToken(SECRET, token, {
      audience: 'ur-agent',
      requiredScope: 'coding-agent',
    })
    expect(result.valid).toBe(true)
    expect(result.claims?.sub).toBe('ur-cli')
  })

  test('rejects an expired token', () => {
    const token = mintDelegationToken(SECRET, {
      subject: 's',
      audience: 'ur-agent',
      ttlSeconds: 100,
      now: 1000,
    })
    expect(verifyDelegationToken(SECRET, token, { now: 1050 }).valid).toBe(true)
    const expired = verifyDelegationToken(SECRET, token, { now: 1100 })
    expect(expired.valid).toBe(false)
    expect(expired.reason).toBe('token expired')
  })

  test('rejects an audience mismatch', () => {
    const token = mintDelegationToken(SECRET, { subject: 's', audience: 'ur-agent' })
    const result = verifyDelegationToken(SECRET, token, { audience: 'other-agent' })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('audience mismatch')
  })

  test('enforces scope, and * grants every skill', () => {
    const scoped = mintDelegationToken(SECRET, {
      subject: 's',
      audience: 'ur-agent',
      scope: ['coding-agent'],
    })
    expect(verifyDelegationToken(SECRET, scoped, { requiredScope: 'coding-agent' }).valid).toBe(true)
    const denied = verifyDelegationToken(SECRET, scoped, { requiredScope: 'browser-agent' })
    expect(denied.valid).toBe(false)
    expect(denied.reason).toContain('not granted')

    const wildcard = mintDelegationToken(SECRET, { subject: 's', audience: 'ur-agent' })
    expect(verifyDelegationToken(SECRET, wildcard, { requiredScope: 'anything' }).valid).toBe(true)
  })

  test('detects tampering and a wrong secret', () => {
    const token = mintDelegationToken(SECRET, { subject: 's', audience: 'ur-agent' })
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

describe('delegation attenuation', () => {
  test('narrows scope and never outlives the parent', () => {
    const parentToken = mintDelegationToken(SECRET, {
      subject: 'root',
      audience: 'ur-agent',
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
      audience: 'ur-agent',
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
      audience: 'ur-agent',
      scope: ['coding-agent'],
    })
    const options = { delegationSecret: SECRET, audience: 'ur-agent' }
    expect(authorizeRequest(post(`Bearer ${token}`), options, 'coding-agent').ok).toBe(true)
    const denied = authorizeRequest(post(`Bearer ${token}`), options, 'browser-agent')
    expect(denied.ok).toBe(false)
    expect(denied.reason).toContain('not granted')
  })
})

describe('a2a task server lifecycle', () => {
  const cwd = (): string => mkdtempSync(join(tmpdir(), 'ur-a2a-'))
  const request = (path: string, init?: RequestInit): Request =>
    new Request(`http://127.0.0.1:8765${path}`, init)

  async function json(response: Response): Promise<any> {
    return await response.json()
  }

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
})
