import { pathToFileURL } from 'node:url'
import {
  getAdditionalDirectoriesForAgentMd,
  getOriginalCwd,
} from '../../bootstrap/state.js'

export type McpRootsClient = {
  sendRootsListChanged(): Promise<void>
}

const connectedClients = new Set<McpRootsClient>()

/** Return every directory the current UR session has explicitly exposed. */
export function listMcpRoots(): Array<{ uri: string; name: string }> {
  const paths = [getOriginalCwd(), ...getAdditionalDirectoriesForAgentMd()]
  const uniquePaths = [...new Set(paths.map(path => path.normalize('NFC')))]
  return uniquePaths.map(path => ({
    uri: pathToFileURL(path).href,
    name: path,
  }))
}

/** Track a connected MCP server so directory changes can be announced. */
export function registerMcpRootsClient(client: McpRootsClient): () => void {
  connectedClients.add(client)
  return () => connectedClients.delete(client)
}

/** Notify connected MCP servers after the session's root set changes. */
export async function notifyMcpRootsListChanged(): Promise<{
  notified: number
  failed: number
}> {
  const results = await Promise.allSettled(
    [...connectedClients].map(client => client.sendRootsListChanged()),
  )
  return {
    notified: results.filter(result => result.status === 'fulfilled').length,
    failed: results.filter(result => result.status === 'rejected').length,
  }
}

/** Test-only isolation for the process-wide connection registry. */
export function resetMcpRootsClientsForTest(): void {
  connectedClients.clear()
}
