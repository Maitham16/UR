// Stub: not included in leaked source
export interface LspServerConfig {}
export interface LspServerState {}
/**
 * Shape of a configured LSP server as produced by getBuiltInLspServers /
 * getPluginLspServers (src/services/lsp/config.ts). Was an empty stub, which
 * let any object assign but made every property access a type error.
 */
export interface ScopedLspServerConfig {
  command: string
  args: string[]
  extensionToLanguage: Record<string, string>
  workspaceFolder?: string
  startupTimeout?: number
  maxRestarts?: number
  scope?: string
  source?: string
  [key: string]: unknown
}
