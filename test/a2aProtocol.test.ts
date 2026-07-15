import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { A2AProtocolRuntime } from '../src/services/agents/a2aProtocol.js'
import { buildA2AAgentCard } from '../src/services/agents/trends.js'

const identity = {
  isAuthenticated: true,
  userName: 'cancel-test',
  scopes: ['coding-agent'],
  requestedSkill: 'coding-agent',
}

function taskResult(response: unknown): {
  id: string
  kind: 'task'
  status: { state: string }
} {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('expected a JSON-RPC response')
  }
  const result = (response as { result?: unknown }).result
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('expected a task result')
  }
  const task = result as {
    id?: unknown
    kind?: unknown
    status?: { state?: unknown }
  }
  if (
    task.kind !== 'task' ||
    typeof task.id !== 'string' ||
    typeof task.status?.state !== 'string'
  ) {
    throw new Error('expected a task result')
  }
  return task as { id: string; kind: 'task'; status: { state: string } }
}

describe('A2A protocol runtime', () => {
  test('handles a nonblocking task cancellation while execution is in flight', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-a2a-protocol-'))
    const runtime = new A2AProtocolRuntime({
      cwd,
      card: buildA2AAgentCard({ baseUrl: 'http://127.0.0.1:8765' }),
      runPrompt: async (_prompt, context) =>
        await new Promise(resolve => {
          context.signal.addEventListener(
            'abort',
            () => resolve({ code: 1, stdout: '', stderr: 'canceled' }),
            { once: true },
          )
        }),
    })

    const sent = await runtime.handle(
      {
        jsonrpc: '2.0',
        id: 'send',
        method: 'message/send',
        params: {
          configuration: { blocking: false },
          message: {
            kind: 'message',
            messageId: 'message-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'wait until canceled' }],
          },
        },
      },
      identity,
    )
    const submittedTask = taskResult(sent)
    expect(submittedTask.kind).toBe('task')

    const canceled = await runtime.handle(
      {
        jsonrpc: '2.0',
        id: 'cancel',
        method: 'tasks/cancel',
        params: { id: submittedTask.id },
      },
      identity,
    )
    const canceledTask = taskResult(canceled)
    expect(canceledTask.status.state).toBe('canceled')
  })
})
