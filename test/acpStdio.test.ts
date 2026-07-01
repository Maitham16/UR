import { describe, expect, test } from 'bun:test'
import {
  createAcpStdioAgent,
  type AcpStdioMessage,
} from '../src/services/agents/acpStdio.js'

function makeAgent(runPrompt?: Parameters<typeof createAcpStdioAgent>[0]['runPrompt']) {
  const out: AcpStdioMessage[] = []
  const agent = createAcpStdioAgent({ cwd: '/work', write: m => out.push(m), runPrompt })
  return { agent, out }
}

describe('stdio ACP agent', () => {
  test('initialize returns protocol version and capabilities', async () => {
    const { agent, out } = makeAgent()
    await agent.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(out[0]!.id).toBe(1)
    const result = out[0]!.result as { protocolVersion: number; agentCapabilities: unknown }
    expect(result.protocolVersion).toBe(1)
    expect(result.agentCapabilities).toBeDefined()
  })

  test('session/new then session/prompt streams a chunk and returns stopReason', async () => {
    const { agent, out } = makeAgent(async (prompt, ctx) => {
      ctx.onChunk(`echo:${prompt}`)
      return { stopReason: 'end_turn' }
    })
    await agent.handle({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} })
    const sessionId = (out[0]!.result as { sessionId: string }).sessionId
    expect(sessionId).toMatch(/^sess_/)

    await agent.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'hello' }] },
    })

    const update = out.find(m => m.method === 'session/update')
    expect(update).toBeDefined()
    const u = update!.params as { update: { sessionUpdate: string; content: { text: string } } }
    expect(u.update.sessionUpdate).toBe('agent_message_chunk')
    expect(u.update.content.text).toBe('echo:hello')

    const final = out.find(m => m.id === 2)
    expect((final!.result as { stopReason: string }).stopReason).toBe('end_turn')
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

  test('session/cancel aborts the in-flight prompt (stopReason cancelled)', async () => {
    const { agent, out } = makeAgent(async (_prompt, ctx) => {
      // Simulate a cancel arriving mid-run by aborting through the same session.
      agentCancel()
      return { stopReason: 'end_turn' }
    })
    let agentCancel = () => {}
    await agent.handle({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} })
    const sessionId = (out[0]!.result as { sessionId: string }).sessionId
    agentCancel = () => {
      void agent.handle({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
    }
    await agent.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: 'work' },
    })
    const final = out.find(m => m.id === 2)
    expect((final!.result as { stopReason: string }).stopReason).toBe('cancelled')
  })

  test('unknown method returns -32601', async () => {
    const { agent, out } = makeAgent()
    await agent.handle({ jsonrpc: '2.0', id: 3, method: 'does/not/exist' })
    expect(out[0]!.error?.code).toBe(-32601)
  })

  test('notifications (no id) never produce a response', async () => {
    const { agent, out } = makeAgent()
    await agent.handle({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'x' } })
    expect(out).toHaveLength(0)
  })
})
