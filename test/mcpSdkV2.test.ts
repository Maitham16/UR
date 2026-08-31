import { Client } from '@modelcontextprotocol/client'
import { Server } from '@modelcontextprotocol/server'
import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { createLinkedTransportPair } from '../src/services/mcp/InProcessTransport.js'

describe('MCP TypeScript SDK v2 integration', () => {
  const closeCallbacks: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.allSettled(closeCallbacks.splice(0).map(close => close()))
  })

  test('negotiates and calls tools across the split client/server packages', async () => {
    const server = new Server(
      { name: 'ur-mcp-v2-test-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    const client = new Client(
      { name: 'ur-mcp-v2-test-client', version: '1.0.0' },
      { capabilities: {} },
    )
    const [clientTransport, serverTransport] = createLinkedTransportPair()
    const customNotification = Promise.withResolvers<string>()

    client.setNotificationHandler(
      'notifications/ur/test',
      { params: z.object({ value: z.string() }) },
      ({ value }) => customNotification.resolve(value),
    )

    server.setRequestHandler('tools/list', async () => ({
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
    }))
    server.setRequestHandler('tools/call', async request => ({
      content: [
        {
          type: 'text',
          text: String(request.params.arguments?.value ?? ''),
        },
      ],
    }))

    closeCallbacks.push(async () => {
      await Promise.allSettled([client.close(), server.close()])
    })
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const listed = await client.listTools()
    expect(listed.tools.map(tool => tool.name)).toEqual(['echo'])

    const result = await client.callTool({
      name: 'echo',
      arguments: { value: 'mcp-v2-ok' },
    })
    expect(result.content).toEqual([{ type: 'text', text: 'mcp-v2-ok' }])

    await server.notification({
      method: 'notifications/ur/test',
      params: { value: 'validated-custom-notification' },
    } as never)
    expect(await customNotification.promise).toBe(
      'validated-custom-notification',
    )
  })
})
