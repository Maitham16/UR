import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { getEmptyToolPermissionContext, type Tool } from '../src/Tool.js'
import { hasPermissionsToUseTool } from '../src/utils/permissions/permissions.js'
import { getNextPermissionMode } from '../src/utils/permissions/getNextPermissionMode.js'

function toolReturningPermission(
  permission: { behavior: 'ask'; message: string } | { behavior: 'deny'; message: string },
): Tool {
  return {
    name: 'TestTool',
    inputSchema: z.object({ value: z.string() }),
    async checkPermissions() {
      return permission
    },
  } as unknown as Tool
}

function contextForMode(mode: 'dontAsk' | 'default') {
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
      },
    }),
  } as never
}

describe('dontAsk permission mode', () => {
  test('auto-approves operations that would otherwise ask for manual approval', async () => {
    const result = await hasPermissionsToUseTool(
      toolReturningPermission({ behavior: 'ask', message: 'approval needed' }),
      { value: 'ok' },
      contextForMode('dontAsk'),
      undefined as never,
      'tool-use-1',
    )

    expect(result).toMatchObject({
      behavior: 'allow',
      updatedInput: { value: 'ok' },
      decisionReason: { type: 'mode', mode: 'dontAsk' },
    })
  })

  test('keeps explicit denials denied', async () => {
    const result = await hasPermissionsToUseTool(
      toolReturningPermission({ behavior: 'deny', message: 'blocked' }),
      { value: 'no' },
      contextForMode('dontAsk'),
      undefined as never,
      'tool-use-2',
    )

    expect(result).toMatchObject({
      behavior: 'deny',
      message: 'blocked',
    })
  })

  test('cycles from plan into dontAsk when bypass is unavailable', () => {
    expect(
      getNextPermissionMode({
        ...getEmptyToolPermissionContext(),
        mode: 'plan',
      }),
    ).toBe('dontAsk')
  })
})
