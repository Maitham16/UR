import { describe, expect, test } from 'bun:test'
import { createToolStub } from '../src/remote/remotePermissionBridge.js'

describe('remote permission tool stubs', () => {
  test('unknown remote tools satisfy the complete Tool render contract', async () => {
    const tool = createToolStub('remote__unknown')

    expect(await tool.inputSchema.safeParseAsync({ query: 'hello' })).toMatchObject({
      success: true,
    })
    expect(await tool.outputSchema.safeParseAsync('result')).toMatchObject({
      success: true,
    })
    expect(typeof tool.renderPermissionRequest).toBe('function')
    expect(
      tool.renderPermissionRequest({} as Parameters<
        typeof tool.renderPermissionRequest
      >[0]),
    ).not.toBeNull()
  })
})
