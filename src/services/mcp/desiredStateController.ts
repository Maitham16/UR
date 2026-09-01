import type { MCPEnablementResult } from './enablement.js'

export type MCPDesiredStateHandler = (
  target: string,
  enabled: boolean,
) => Promise<MCPEnablementResult>

let activeHandler: MCPDesiredStateHandler | null = null

/**
 * Register the live connection manager as the process-wide desired-state
 * controller. Commands can use this service without manufacturing a React
 * component solely to access context.
 */
export function registerMcpDesiredStateHandler(
  handler: MCPDesiredStateHandler,
): () => void {
  activeHandler = handler
  return () => {
    if (activeHandler === handler) activeHandler = null
  }
}

export async function setMcpServersDesiredState(
  target: string,
  enabled: boolean,
): Promise<MCPEnablementResult> {
  if (!activeHandler) {
    throw new Error('MCP connection manager is not ready')
  }
  return activeHandler(target, enabled)
}
