import { afterEach, describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  handleTriggerRequest,
  startTriggerReceiver,
  TriggerDispatchQueue,
  TriggerReceiverState,
  type TriggerDispatchEvent,
  type TriggerDispatcher,
  type TriggerHttpRequest,
} from '../src/services/agents/triggerReceiver.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

function collector(): { dispatcher: TriggerDispatcher; events: TriggerDispatchEvent[] } {
  const events: TriggerDispatchEvent[] = []
  return { dispatcher: { enqueue: event => (events.push(event), true) }, events }
}

function request(path: string, payload: unknown, headers: Record<string, string> = {}): TriggerHttpRequest {
  return {
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/json', ...headers },
    body: Buffer.from(JSON.stringify(payload)),
  }
}

function githubRequest(payload: unknown, secret: string, delivery = 'delivery-1'): TriggerHttpRequest {
  const result = request('/events/github', payload, {
    'x-github-delivery': delivery,
    'x-github-event': 'issue_comment',
  })
  result.headers['x-hub-signature-256'] = `sha256=${createHmac('sha256', secret).update(result.body).digest('hex')}`
  return result
}

describe('trigger HTTP receiver', () => {
  test('Commander registers and forwards the loopback require-auth override', () => {
    const source = readFileSync(join(import.meta.dir, '../src/main.tsx'), 'utf-8')
    const start = source.indexOf("program.command('trigger [action]')")
    const end = source.indexOf("program.command('speak [text...]')", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const triggerCommand = source.slice(start, end)
    expect(triggerCommand).toContain(".option('--require-auth'")
    expect(triggerCommand).toContain('requireAuth?: boolean;')
    expect(triggerCommand).toContain("opts.requireAuth ? '--require-auth'")
  })

  test('provider routes fail closed when their verification secret is absent', async () => {
    const { dispatcher } = collector()
    const response = await handleTriggerRequest(
      request('/events/github', { comment: { body: '/ur work' } }),
      { state: new TriggerReceiverState(), dispatcher, secrets: {} },
    )
    expect(response.status).toBe(503)
    expect(response.body).not.toContain('undefined')
  })

  test('propagates verified state and labels relaxed local events as unverified', async () => {
    const local = collector()
    const localResponse = await handleTriggerRequest(
      request('/events/generic', { id: 'local-event', prompt: 'run locally' }),
      {
        state: new TriggerReceiverState(),
        dispatcher: local.dispatcher,
        secrets: {},
        insecureDevelopment: true,
      },
    )
    expect(localResponse.status).toBe(202)
    expect(local.events[0]?.authenticationVerified).toBe(false)

    const verified = collector()
    const verifiedResponse = await handleTriggerRequest(
      request(
        '/events/generic',
        { id: 'verified-event', prompt: 'run verified' },
        { authorization: 'Bearer receiver-secret' },
      ),
      {
        state: new TriggerReceiverState(),
        dispatcher: verified.dispatcher,
        secrets: { generic: 'receiver-secret' },
      },
    )
    expect(verifiedResponse.status).toBe(202)
    expect(verified.events[0]?.authenticationVerified).toBe(true)

    const prompts: string[] = []
    const queue = new TriggerDispatchQueue({
      state: new TriggerReceiverState(),
      cwd: process.cwd(),
      bin: { file: 'ur', baseArgs: [] },
      runCommand: async command => {
        prompts.push(command.args.at(-1) ?? '')
        return { code: 0 }
      },
    })
    expect(queue.enqueue(local.events[0]!)).toBe(true)
    await queue.whenIdle()
    expect(prompts[0]).toContain('"authentication":"not-verified-local"')
    expect(prompts[0]).not.toContain('Authenticated inbound event')
  })

  test('persists only hashed context/delivery keys and reloads the stable session', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ur-trigger-state-')), 'state.json')
    const state = new TriggerReceiverState(path)
    const first = state.ensureSession('github:private/repository:77')
    state.rememberDelivery('github', 'raw-private-delivery-id')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).not.toContain('private/repository')
    expect(raw).not.toContain('raw-private-delivery-id')

    const reloaded = new TriggerReceiverState(path)
    expect(reloaded.ensureSession('github:private/repository:77').sessionId).toBe(first.sessionId)
    expect(reloaded.hasDelivery('github', 'raw-private-delivery-id')).toBe(true)
  })

  test('fails closed instead of discarding malformed durable state', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ur-trigger-state-bad-')), 'state.json')
    writeFileSync(path, '{"version":1,"sessions":[{"sessionId":"not-a-uuid"}]}')
    expect(() => new TriggerReceiverState(path)).toThrow('could not be loaded')
  })

  test('verifies GitHub HMAC, deduplicates delivery IDs, and reuses an issue session', async () => {
    const secret = 'github-test-secret'
    const state = new TriggerReceiverState()
    const { dispatcher, events } = collector()
    const options = { state, dispatcher, secrets: { github: secret } }
    const base = {
      comment: { body: '/ur fix the test', user: { login: 'octocat' } },
      issue: { number: 42 },
      repository: { full_name: 'acme/widgets' },
      sender: { login: 'octocat' },
    }

    const invalid = await handleTriggerRequest(request('/events/github', base), options)
    expect(invalid.status).toBe(401)

    const first = await handleTriggerRequest(githubRequest(base, secret, 'one'), options)
    const duplicate = await handleTriggerRequest(githubRequest(base, secret, 'one'), options)
    const followup = await handleTriggerRequest(githubRequest({
      ...base,
      comment: { body: '/ur now add coverage', user: { login: 'octocat' } },
    }, secret, 'two'), options)
    expect(first.status).toBe(202)
    expect(duplicate.status).toBe(200)
    expect(followup.status).toBe(202)
    expect(events).toHaveLength(2)
    expect(events[0]?.sessionId).toBe(events[1]?.sessionId)
    expect(events[0]?.sessionKey).toBe('github:acme/widgets:42')
  })

  test('applies an actor allow-list after authenticating the provider request', async () => {
    const { dispatcher, events } = collector()
    const payload = {
      comment: { body: '/ur delete nothing' },
      issue: { number: 5 },
      repository: { full_name: 'acme/widgets' },
      sender: { login: 'untrusted-user' },
    }
    const response = await handleTriggerRequest(githubRequest(payload, 'secret'), {
      state: new TriggerReceiverState(),
      dispatcher,
      secrets: { github: 'secret' },
      allowLists: { github: new Set(['release-bot']) },
    })
    expect(response.status).toBe(403)
    expect(events).toHaveLength(0)
  })

  test('verifies Slack timestamp/signature and handles URL verification without dispatch', async () => {
    const secret = 'slack-test-secret'
    const now = 1_800_000_000_000
    const { dispatcher, events } = collector()
    const signed = request('/events/slack', { type: 'url_verification', challenge: 'challenge-value' })
    const timestamp = String(Math.floor(now / 1000))
    signed.headers['x-slack-request-timestamp'] = timestamp
    signed.headers['x-slack-signature'] = `v0=${createHmac('sha256', secret)
      .update(`v0:${timestamp}:${signed.body.toString('utf-8')}`)
      .digest('hex')}`

    const response = await handleTriggerRequest(signed, {
      state: new TriggerReceiverState(),
      dispatcher,
      secrets: { slack: secret },
      now: () => now,
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body).challenge).toBe('challenge-value')
    expect(events).toHaveLength(0)

    const stale = { ...signed, headers: { ...signed.headers, 'x-slack-request-timestamp': '1' } }
    expect((await handleTriggerRequest(stale, {
      state: new TriggerReceiverState(),
      dispatcher,
      secrets: { slack: secret },
      now: () => now,
    })).status).toBe(401)
  })

  test('accepts Gmail Pub/Sub with a configured token and keeps one session per mailbox', async () => {
    const { dispatcher, events } = collector()
    const state = new TriggerReceiverState()
    const options = { state, dispatcher, secrets: { gmail: 'mail-token' } }
    const envelope = (messageId: string, historyId: string) => ({
      message: {
        messageId,
        data: Buffer.from(JSON.stringify({ emailAddress: 'ops@example.com', historyId })).toString('base64'),
      },
      subscription: 'projects/example/subscriptions/mail',
    })
    const first = request('/events/gmail', envelope('m1', '101'), { authorization: 'Bearer mail-token' })
    const second = request('/events/gmail?token=mail-token', envelope('m2', '102'))

    expect((await handleTriggerRequest(first, options)).status).toBe(202)
    expect((await handleTriggerRequest(second, options)).status).toBe(202)
    expect(events).toHaveLength(2)
    expect(events[0]?.sessionId).toBe(events[1]?.sessionId)
    expect(events[0]?.decision.context.mailbox).toBe('ops@example.com')
  })

  test('validates Teams Graph clientState and fans out batched notifications', async () => {
    const { dispatcher, events } = collector()
    const payload = {
      value: [
        { subscriptionId: 's1', clientState: 'teams-token', resource: 'chats/chat-a/messages/1', resourceData: { id: '1' } },
        { subscriptionId: 's1', clientState: 'teams-token', resource: 'chats/chat-a/messages/2', resourceData: { id: '2' } },
      ],
    }
    const response = await handleTriggerRequest(request('/events/teams', payload), {
      state: new TriggerReceiverState(),
      dispatcher,
      secrets: { teams: 'teams-token' },
    })
    expect(response.status).toBe(202)
    expect(events).toHaveLength(2)
    expect(events[0]?.sessionId).toBe(events[1]?.sessionId)
    expect(events[0]?.decision.context.conversationId).toBe('chat-a')
  })

  test('caps HTTP bodies before JSON parsing', async () => {
    const { dispatcher } = collector()
    const receiver = await startTriggerReceiver({
      host: '127.0.0.1',
      port: 0,
      maxBodyBytes: 1024,
      insecureDevelopment: true,
      state: new TriggerReceiverState(),
      dispatcher,
      secrets: {},
    })
    servers.push(receiver.server)
    const response = await fetch(`${receiver.url}/events/generic`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x'.repeat(2048) }),
    })
    expect(response.status).toBe(413)
  })

  test('starts then resumes the stable session while serializing one conversation', async () => {
    const state = new TriggerReceiverState()
    const commands: string[][] = []
    let concurrent = 0
    let peak = 0
    let sessionMaterialized = false
    const queue = new TriggerDispatchQueue({
      state,
      cwd: process.cwd(),
      bin: { file: 'ur', baseArgs: [] },
      maxConcurrency: 4,
      sessionExists: () => sessionMaterialized,
      runCommand: async command => {
        commands.push(command.args)
        concurrent += 1
        peak = Math.max(peak, concurrent)
        await Promise.resolve()
        sessionMaterialized = true
        concurrent -= 1
        return { code: 0 }
      },
    })
    const session = state.ensureSession('slack:C1:thread-1')
    const decision = {
      source: 'slack' as const,
      keyword: '/ur',
      triggered: true,
      reason: 'test',
      prompt: 'continue the work',
      context: { channel: 'C1', threadTs: 'thread-1' },
    }
    expect(queue.enqueue({ decision, sessionKey: 'slack:C1:thread-1', sessionId: session.sessionId, deliveryId: 'one', authenticationVerified: true })).toBe(true)
    expect(queue.enqueue({ decision, sessionKey: 'slack:C1:thread-1', sessionId: session.sessionId, deliveryId: 'two', authenticationVerified: true })).toBe(true)
    await queue.whenIdle()

    expect(peak).toBe(1)
    expect(commands).toHaveLength(2)
    expect(commands[0]).toContain('--session-id')
    expect(commands[1]).toContain('--resume')
    expect(commands[1]).not.toContain('--session-id')
    expect(commands[0]?.at(-1)).toContain('"authentication":"verified"')
  })
})
