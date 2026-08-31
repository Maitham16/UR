import { createServer } from 'node:http'
import { afterEach, describe, expect, test } from 'bun:test'
import { TaskState, type StreamResponse } from '@a2a-js/sdk'
import { ServerCallContext } from '@a2a-js/sdk/server'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SecureA2APushNotificationSender,
  SecureA2APushNotificationStore,
  resolveSecureA2APushUrl,
} from '../src/services/agents/a2aPushNotifications.js'
import { A2AProtocolRuntime } from '../src/services/agents/a2aProtocol.js'
import { A2AV1ProtocolRuntime } from '../src/services/agents/a2aV1.js'
import { buildA2AV1AgentCard } from '../src/services/agents/trends.js'

const identity = {
  isAuthenticated: true,
  userName: 'push-test',
}

function context(): ServerCallContext {
  return new ServerCallContext({
    user: identity,
    requestedVersion: '1.0',
  })
}

const previousAllowedOrigins = process.env.UR_A2A_PUSH_ALLOWED_ORIGINS

afterEach(() => {
  if (previousAllowedOrigins === undefined) {
    delete process.env.UR_A2A_PUSH_ALLOWED_ORIGINS
  } else {
    process.env.UR_A2A_PUSH_ALLOWED_ORIGINS = previousAllowedOrigins
  }
})

describe('A2A push notifications', () => {
  test('allows loopback development callbacks but rejects unsafe public targets', async () => {
    await expect(
      resolveSecureA2APushUrl('http://example.com/hooks/a2a'),
    ).rejects.toThrow('HTTPS')
    await expect(
      resolveSecureA2APushUrl('http://127.0.0.1/hooks/a2a'),
    ).resolves.toMatchObject({ address: '127.0.0.1', family: 4 })
    await expect(
      resolveSecureA2APushUrl('https://169.254.169.254/latest/meta-data'),
    ).rejects.toThrow('non-public IP')
    await expect(
      resolveSecureA2APushUrl('https://[0:0:0:0:0:0:0:1]/hooks/a2a'),
    ).resolves.toMatchObject({ family: 6 })
    await expect(
      resolveSecureA2APushUrl('https://[::ffff:127.0.0.1]/hooks/a2a'),
    ).resolves.toMatchObject({ family: 6 })
  })

  test('requires outbound webhook authentication only for public destinations', async () => {
    const store = new SecureA2APushNotificationStore()
    await expect(
      store.save('task-1', context(), {
        tenant: '',
        id: '',
        taskId: 'task-1',
        url: 'https://8.8.8.8/hook',
        token: '',
        authentication: undefined,
      }),
    ).rejects.toThrow('require authentication')
  })

  test('delivers to a loopback receiver without throwaway authentication', async () => {
    let receivedAuthorization: string | undefined
    let resolveReceived!: () => void
    const received = new Promise<void>(resolve => {
      resolveReceived = resolve
    })
    const server = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization
      request.resume()
      request.on('end', () => {
        response.writeHead(204)
        response.end()
        resolveReceived()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('unexpected server address')
      const store = new SecureA2APushNotificationStore()
      const config = {
        tenant: '',
        id: '',
        taskId: 'task-local',
        url: `http://127.0.0.1:${address.port}/events`,
        token: '',
        authentication: undefined,
      }
      await store.save('task-local', context(), config)
      await new SecureA2APushNotificationSender(store).send(
        {
          payload: {
            $case: 'statusUpdate',
            value: {
              taskId: 'task-local',
              contextId: 'context-local',
              status: {
                state: TaskState.TASK_STATE_COMPLETED,
                message: undefined,
                timestamp: new Date().toISOString(),
              },
              metadata: undefined,
            },
          },
        },
        context(),
      )
      await received
      expect(receivedAuthorization).toBeUndefined()
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  test('pins an explicitly allowed development origin and sends authenticated v1 events', async () => {
    let receivedAuthorization = ''
    let receivedContentType = ''
    let receivedBody = ''
    let resolveReceived!: () => void
    const received = new Promise<void>(resolve => {
      resolveReceived = resolve
    })
    const server = createServer((request, response) => {
      receivedAuthorization = String(request.headers.authorization ?? '')
      receivedContentType = String(request.headers['content-type'] ?? '')
      request.setEncoding('utf8')
      request.on('data', chunk => {
        receivedBody += String(chunk)
      })
      request.on('end', () => {
        response.writeHead(204)
        response.end()
        resolveReceived()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('unexpected server address')
      }
      const origin = `http://127.0.0.1:${address.port}`
      process.env.UR_A2A_PUSH_ALLOWED_ORIGINS = origin
      const store = new SecureA2APushNotificationStore()
      const callContext = context()
      const config = {
        tenant: '',
        id: '',
        taskId: 'task-delivery',
        url: `${origin}/events/a2a`,
        token: '',
        authentication: {
          scheme: 'Bearer',
          credentials: 'receiver-secret',
        },
      }
      await store.save('task-delivery', callContext, config)
      expect(config.id).not.toBe('')

      const event: StreamResponse = {
        payload: {
          $case: 'statusUpdate',
          value: {
            taskId: 'task-delivery',
            contextId: 'context-delivery',
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              message: undefined,
              timestamp: new Date().toISOString(),
            },
            metadata: undefined,
          },
        },
      }
      await new SecureA2APushNotificationSender(store).send(
        event,
        callContext,
      )
      await received

      expect(receivedAuthorization).toBe('Bearer receiver-secret')
      expect(receivedContentType).toBe('application/a2a+json')
      expect(JSON.parse(receivedBody).statusUpdate.status.state).toBe(
        'TASK_STATE_COMPLETED',
      )
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  test('delivers SDK lifecycle events for a streaming request with an embedded push config', async () => {
    const received: Array<{ authorization: string; body: any }> = []
    let resolveCompleted!: () => void
    const completed = new Promise<void>(resolve => {
      resolveCompleted = resolve
    })
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => {
        body += String(chunk)
      })
      request.on('end', () => {
        const parsed = JSON.parse(body)
        received.push({
          authorization: String(request.headers.authorization ?? ''),
          body: parsed,
        })
        response.writeHead(204)
        response.end()
        if (
          parsed.statusUpdate?.status?.state === 'TASK_STATE_COMPLETED'
        ) {
          resolveCompleted()
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('unexpected server address')
      }
      const origin = `http://127.0.0.1:${address.port}`
      process.env.UR_A2A_PUSH_ALLOWED_ORIGINS = origin
      const runtime = new A2AV1ProtocolRuntime(
        new A2AProtocolRuntime({
          cwd: mkdtempSync(join(tmpdir(), 'ur-a2a-push-e2e-')),
          card: buildA2AV1AgentCard({ baseUrl: 'http://127.0.0.1:8765' }),
          dryRun: true,
        }),
      )
      const stream = runtime.sendMessageStream(
        {
          metadata: { skill: 'coding-agent' },
          configuration: {
            taskPushNotificationConfig: {
              url: `${origin}/a2a-events`,
              authentication: {
                scheme: 'Bearer',
                credentials: 'stream-secret',
              },
            },
          },
          message: {
            messageId: 'push-stream-message',
            role: 'ROLE_USER',
            parts: [{ text: 'stream and push this task' }],
          },
        },
        {
          isAuthenticated: true,
          userName: 'push-stream-user',
          scopes: ['coding-agent'],
          requestedSkill: 'coding-agent',
        },
      )
      for await (const _event of stream) {
        // Draining the SSE source drives the complete task lifecycle.
      }
      await Promise.race([
        completed,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error('timed out waiting for push delivery')),
            2_000,
          ),
        ),
      ])
      expect(received.length).toBeGreaterThanOrEqual(3)
      expect(
        received.every(entry => entry.authorization === 'Bearer stream-secret'),
      ).toBe(true)
      expect(received.some(entry => entry.body.task)).toBe(true)
      expect(received.some(entry => entry.body.artifactUpdate)).toBe(true)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
