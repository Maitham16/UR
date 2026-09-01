import { describe, expect, test } from 'bun:test'
import {
  applyMcpEnablementPlan,
  formatMcpEnablementResult,
  planMcpServerEnablement,
  reconcileMcpConnectionWithDesiredState,
} from '../src/services/mcp/enablement.js'
import {
  registerMcpDesiredStateHandler,
  setMcpServersDesiredState,
} from '../src/services/mcp/desiredStateController.js'
import { getMcpToolsCommandsAndResources } from '../src/services/mcp/client.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../src/services/mcp/types.js'

const clients = [
  { name: 'alpha', type: 'connected' },
  { name: 'beta', type: 'disabled' },
  { name: 'ide', type: 'connected' },
]

describe('MCP explicit enablement planning', () => {
  test('never toggles a server already in the requested state', () => {
    const plan = planMcpServerEnablement(clients, 'alpha', true)
    expect(plan.matched.map(item => item.name)).toEqual(['alpha'])
    expect(plan.toChange).toEqual([])
    expect(
      formatMcpEnablementResult('alpha', true, {
        ...plan,
        changed: [],
        failures: [],
      }),
    ).toBe('MCP server "alpha" is already enabled')
  })

  test('bulk operations exclude the IDE transport and change only mismatches', () => {
    const enablePlan = planMcpServerEnablement(clients, 'all', true)
    const disablePlan = planMcpServerEnablement(clients, 'all', false)
    expect(enablePlan.matched.map(item => item.name)).toEqual(['alpha', 'beta'])
    expect(enablePlan.toChange.map(item => item.name)).toEqual(['beta'])
    expect(disablePlan.toChange.map(item => item.name)).toEqual(['alpha'])
  })

  test('surfaces partial failures instead of reporting premature success', () => {
    const plan = planMcpServerEnablement(clients, 'all', false)
    const message = formatMcpEnablementResult('all', false, {
      ...plan,
      changed: [],
      failures: [{ name: 'alpha', message: 'connection close failed' }],
    })
    expect(message).toContain('failed 1')
    expect(message).toContain('alpha: connection close failed')
  })

  test('does not report enabled when the runtime reconnect fails', async () => {
    const plan = planMcpServerEnablement(clients, 'beta', true)
    const failed = await applyMcpEnablementPlan(
      plan,
      true,
      async name => ({
        name,
        type: 'failed',
        error: 'connection refused',
      }),
    )

    expect(failed.changed).toEqual([])
    expect(failed.failures).toEqual([
      { name: 'beta', message: 'connection refused' },
    ])
    expect(formatMcpEnablementResult('beta', true, failed)).toContain(
      'failed 1',
    )
  })

  test('reports authentication-required reconnects as enable failures', async () => {
    const plan = planMcpServerEnablement(clients, 'beta', true)
    const result = await applyMcpEnablementPlan(
      plan,
      true,
      async name => ({ name, type: 'needs-auth' }),
    )

    expect(result.changed).toEqual([])
    expect(result.failures[0]?.message).toBe('authentication required')
  })

  test('retries every non-connected state instead of calling it already enabled', () => {
    for (const type of ['failed', 'needs-auth', 'pending']) {
      const plan = planMcpServerEnablement(
        [{ name: 'beta', type }],
        'beta',
        true,
      )
      expect(plan.toChange.map(item => item.name)).toEqual(['beta'])
    }
  })

  test('a late pending connection cannot overwrite disabled desired state', () => {
    const config = {
      type: 'stdio',
      command: 'demo',
      args: [] as string[],
      scope: 'dynamic',
    } as const
    const lateConnection = {
      name: 'beta',
      type: 'connected' as const,
      config,
    } as never

    expect(
      reconcileMcpConnectionWithDesiredState(lateConnection, true),
    ).toEqual({ name: 'beta', type: 'disabled', config })
  })

  test('startup callback discards and closes a connection disabled while pending', async () => {
    const config: ScopedMcpServerConfig = {
      type: 'stdio',
      command: 'demo',
      args: [],
      scope: 'dynamic',
    }
    let disabled = false
    let releaseConnection!: () => void
    let markConnectionStarted!: () => void
    const connectionStarted = new Promise<void>(resolve => {
      markConnectionStarted = resolve
    })
    const connectionGate = new Promise<void>(resolve => {
      releaseConnection = resolve
    })
    const callbacks: Array<{
      client: MCPServerConnection
      tools: unknown[]
      commands: unknown[]
    }> = []
    let cleared = false

    const loading = getMcpToolsCommandsAndResources(
      result => callbacks.push(result),
      { beta: config },
      {
        isServerDisabled: () => disabled,
        connectServer: async () => {
          markConnectionStarted()
          await connectionGate
          return {
            name: 'beta',
            type: 'connected',
            config,
          } as MCPServerConnection
        },
        clearServer: async () => {
          cleared = true
        },
      },
    )

    await connectionStarted
    disabled = true
    releaseConnection()
    await loading

    expect(cleared).toBe(true)
    expect(callbacks).toEqual([
      {
        client: { name: 'beta', type: 'disabled', config },
        tools: [],
        commands: [],
      },
    ])
  })

  test('non-React desired-state controller delegates to the live manager', async () => {
    const calls: Array<[string, boolean]> = []
    const unregister = registerMcpDesiredStateHandler(async (target, enabled) => {
      calls.push([target, enabled])
      return { matched: [], toChange: [], changed: [], failures: [] }
    })
    try {
      await setMcpServersDesiredState('beta', false)
      expect(calls).toEqual([['beta', false]])
    } finally {
      unregister()
    }
  })
})
