import { buildComputerUseTools } from './computerUseCompat.js'
import { buildMcpToolName } from '../../services/mcp/mcpStringUtils.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'

import { resolveUrExecutable } from '../urExecutable.js'
import { CLI_CU_CAPABILITIES, COMPUTER_USE_MCP_SERVER_NAME } from './common.js'
import { getChicagoCoordinateMode } from './gates.js'

/**
 * Build the dynamic MCP config + allowed tool names. Mirror of
 * `setupURInChrome`. The `mcp__computer-use__*` tools are added to
 * `allowedTools` so they bypass the normal permission prompt — the package's
 * `request_access` handles approval for the whole session.
 *
 * The MCP layer isn't ceremony: the API backend detects `mcp__computer-use__*`
 * tool names and emits a CU availability hint into the system prompt
 * (COMPUTER_USE_MCP_AVAILABILITY_HINT in the urhq repo). Built-in tools
 * with different names wouldn't trigger it. Cowork uses the same names for the
 * same reason (apps/desktop/src/main/local-agent-mode/systemPrompt.ts:314).
 */
export function setupComputerUseMCP(): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
} {
  const allowedTools = buildComputerUseTools(
    CLI_CU_CAPABILITIES,
    getChicagoCoordinateMode(),
  ).map(t => buildMcpToolName(COMPUTER_USE_MCP_SERVER_NAME, t.name))

  // command/args are never spawned — client.ts intercepts by name and
  // uses the in-process server. The config just needs to exist with
  // type 'stdio' to hit the right branch. Mirrors Chrome's setup.
  const entry = resolveUrExecutable()
  const args = [...entry.baseArgs, '--computer-use-mcp']

  return {
    mcpConfig: {
      [COMPUTER_USE_MCP_SERVER_NAME]: {
        type: 'stdio',
        command: entry.file,
        args,
        scope: 'dynamic',
      } as const,
    },
    allowedTools,
  }
}
