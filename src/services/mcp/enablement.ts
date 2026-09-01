import type { MCPServerConnection } from './types.js'

export type MCPEnablementClient = {
  name: string
  type: string
}

export type MCPEnablementPlan = {
  matched: MCPEnablementClient[]
  toChange: MCPEnablementClient[]
}

export type MCPEnablementFailure = {
  name: string
  message: string
}

export type MCPEnablementResult = MCPEnablementPlan & {
  changed: string[]
  failures: MCPEnablementFailure[]
}

export type MCPEnablementTransitionResult = {
  name: string
  type: string
  error?: string
}

/** Pure selection logic shared by the manager and regression tests. */
export function planMcpServerEnablement(
  clients: readonly MCPEnablementClient[],
  target: string,
  enabled: boolean,
): MCPEnablementPlan {
  const manageable = clients.filter(client => client.name !== 'ide')
  const matched =
    target === 'all'
      ? manageable
      : manageable.filter(client => client.name === target)
  return {
    matched,
    toChange: matched.filter(client =>
      enabled ? client.type !== 'connected' : client.type !== 'disabled',
    ),
  }
}

/**
 * A connection callback may arrive after the user disabled a pending server.
 * Desired state wins over the stale runtime result and no tools may be
 * republished for that server.
 */
export function reconcileMcpConnectionWithDesiredState(
  client: MCPServerConnection,
  disabled: boolean,
): MCPServerConnection {
  if (!disabled || client.type === 'disabled') return client
  return {
    name: client.name,
    type: 'disabled',
    config: client.config,
  }
}

export function formatMcpEnablementResult(
  target: string,
  enabled: boolean,
  result: MCPEnablementResult,
): string {
  const state = enabled ? 'enabled' : 'disabled'
  if (result.matched.length === 0) {
    return target === 'all'
      ? 'No MCP servers found'
      : `MCP server "${target}" not found`
  }
  if (result.toChange.length === 0) {
    return target === 'all'
      ? `All MCP servers are already ${state}`
      : `MCP server "${target}" is already ${state}`
  }
  if (result.failures.length > 0) {
    const failed = result.failures
      .map(item => `${item.name}: ${item.message}`)
      .join('; ')
    return `Changed ${result.changed.length} MCP server(s); failed ${result.failures.length}: ${failed}`
  }
  return target === 'all'
    ? `${enabled ? 'Enabled' : 'Disabled'} ${result.changed.length} MCP server(s)`
    : `MCP server "${target}" ${state}`
}

function transitionFailureMessage(
  outcome: MCPEnablementTransitionResult,
  enabled: boolean,
): string | null {
  const expected = enabled ? 'connected' : 'disabled'
  if (outcome.type === expected) return null
  if (outcome.type === 'failed' && outcome.error) return outcome.error
  if (outcome.type === 'needs-auth') return 'authentication required'
  return `expected ${expected} state, received ${outcome.type}`
}

/**
 * Apply a prepared desired-state plan and validate the resulting runtime state.
 * Persisting an enabled configuration is not reported as success when its
 * connection actually failed or still requires authentication.
 */
export async function applyMcpEnablementPlan(
  plan: MCPEnablementPlan,
  enabled: boolean,
  transition: (
    serverName: string,
    enabled: boolean,
  ) => Promise<MCPEnablementTransitionResult>,
): Promise<MCPEnablementResult> {
  const settled = await Promise.allSettled(
    plan.toChange.map(async client => {
      const outcome = await transition(client.name, enabled)
      const failure = transitionFailureMessage(outcome, enabled)
      if (failure) throw new Error(failure)
      return outcome
    }),
  )
  const changed: string[] = []
  const failures: MCPEnablementFailure[] = []
  settled.forEach((result, index) => {
    const name = plan.toChange[index]!.name
    if (result.status === 'fulfilled') {
      changed.push(name)
    } else {
      const reason = result.reason
      failures.push({
        name,
        message: reason instanceof Error ? reason.message : String(reason),
      })
    }
  })
  return { ...plan, changed, failures }
}
