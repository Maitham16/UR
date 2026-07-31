/**
 * Shapes for the MCP settings UI. The original definitions are not part of this
 * distribution, so these are reconstructed from how the components use them.
 *
 * They were previously seven empty interfaces. An empty interface does not mean
 * "unknown shape" to TypeScript — it means "has no members", so *every* property
 * access on one is an error. That produced ~221 of the 858 errors sitting behind
 * @ts-nocheck, and it is why the MCP menus carry the suppression at all: those
 * files are not wrong, their types were.
 *
 * Fields whose internal structure the components never inspect are typed as
 * unknown-bearing records rather than `any`, so a consumer must still narrow
 * before reaching inside. `transport` is a literal discriminant — MCPSettings
 * branches on `transport === 'stdio'` and `transport === 'urai-proxy'` — so the
 * union narrows instead of collapsing.
 */

export type McpTransport = 'stdio' | 'http' | 'sse' | 'urai-proxy' | 'agent'

/** Connection handle. Its internals are owned by the MCP client layer. */
export type McpClientHandle = Record<string, unknown>

/** Persisted server configuration as stored in settings. */
export type McpServerConfig = Record<string, unknown>

/** Common to every entry the settings list renders. */
export interface ServerInfo {
  name: string
  scope: string
}

export interface URAIServerInfo extends ServerInfo {
  transport: 'urai-proxy'
  client: McpClientHandle
  config: McpServerConfig
  isAuthenticated: boolean
}

export interface HTTPServerInfo extends ServerInfo {
  transport: 'http'
  client: McpClientHandle
  config: McpServerConfig
  isAuthenticated: boolean
}

export interface SSEServerInfo extends ServerInfo {
  transport: 'sse'
  client: McpClientHandle
  config: McpServerConfig
  isAuthenticated: boolean
}

export interface StdioServerInfo extends ServerInfo {
  transport: 'stdio'
  client: McpClientHandle
  config: McpServerConfig
}

/** Servers contributed by an agent definition rather than by settings. */
export interface AgentMcpServerInfo {
  name: string
  transport: McpTransport
  command?: string
  url?: string
  isAuthenticated: boolean
  needsAuth: boolean
  sourceAgents: string[]
}

export interface MCPViewState {
  server?:
    | URAIServerInfo
    | HTTPServerInfo
    | SSEServerInfo
    | StdioServerInfo
    | AgentMcpServerInfo
  [key: string]: unknown
}
