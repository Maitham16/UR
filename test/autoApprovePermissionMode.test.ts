import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { getEmptyToolPermissionContext, type Tool } from '../src/Tool.js'
import { getNextPermissionMode } from '../src/utils/permissions/getNextPermissionMode.js'
import { hasPermissionsToUseTool } from '../src/utils/permissions/permissions.js'

type StubPermission =
  | { behavior: 'ask'; message: string }
  | { behavior: 'deny'; message: string }

function toolReturningPermission(
  permission: StubPermission,
  options: { requiresUserInteraction?: boolean } = {},
): Tool {
  return {
    name: 'TestTool',
    inputSchema: z.object({ value: z.string() }),
    requiresUserInteraction: options.requiresUserInteraction
      ? () => true
      : undefined,
    async checkPermissions() {
      return permission
    },
  } as unknown as Tool
}

function contextForMode(mode: 'autoApprove' | 'dontAsk' | 'default') {
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

describe('autoApprove permission mode', () => {
  test('auto-approves operations that would otherwise ask for permission approval', async () => {
    const result = await hasPermissionsToUseTool(
      toolReturningPermission({ behavior: 'ask', message: 'approval needed' }),
      { value: 'ok' },
      contextForMode('autoApprove'),
      undefined as never,
      'tool-use-1',
    )

    expect(result).toMatchObject({
      behavior: 'allow',
      updatedInput: { value: 'ok' },
      decisionReason: { type: 'mode', mode: 'autoApprove' },
    })
  })

  test('still asks for user-interaction tools', async () => {
    const result = await hasPermissionsToUseTool(
      toolReturningPermission(
        { behavior: 'ask', message: 'needs user input' },
        { requiresUserInteraction: true },
      ),
      { value: 'question' },
      contextForMode('autoApprove'),
      undefined as never,
      'tool-use-2',
    )

    expect(result).toMatchObject({
      behavior: 'ask',
      message: 'needs user input',
    })
  })

  test('keeps explicit denials denied', async () => {
    const result = await hasPermissionsToUseTool(
      toolReturningPermission({ behavior: 'deny', message: 'blocked' }),
      { value: 'no' },
      contextForMode('autoApprove'),
      undefined as never,
      'tool-use-3',
    )

    expect(result).toMatchObject({
      behavior: 'deny',
      message: 'blocked',
    })
  })

  test('dontAsk still denies instead of asking', async () => {
    const result = await hasPermissionsToUseTool(
      toolReturningPermission({ behavior: 'ask', message: 'approval needed' }),
      { value: 'ok' },
      contextForMode('dontAsk'),
      undefined as never,
      'tool-use-4',
    )

    expect(result).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'dontAsk' },
    })
  })

  test('cycles from plan into autoApprove when bypass is unavailable', () => {
    expect(
      getNextPermissionMode({
        ...getEmptyToolPermissionContext(),
        mode: 'plan',
      }),
    ).toBe('autoApprove')
  })
})
