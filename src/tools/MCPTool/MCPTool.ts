import { z } from 'zod/v4'
import { wrapUntrusted } from '../../security/promptInjection.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { isOutputLineTruncated } from '../../utils/terminal.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

// Allow any input object since MCP tools define their own schemas
export const inputSchema = lazySchema(() => z.object({}).passthrough())
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.string().describe('MCP tool execution result'),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Re-export MCPProgress from centralized types to break import cycles
export type { MCPProgress } from '../../types/tools.js'

/**
 * `call()` is overridden in mcpClient.ts to return `mcpResult.content` — the
 * MCP protocol's array of blocks — so the declared `Output = string` above is
 * only the placeholder shape. Both forms occur, and images must survive
 * untouched, so wrap the text in place rather than stringifying the whole
 * payload.
 *
 * `trustedControlChannel` opts a tool out entirely. The configured
 * permission-prompt tool returns a decision that `print.ts` JSON-parses; that
 * is UR's own control plane, not model-facing context, and wrapping it would
 * break every permission decision.
 */
export function wrapMcpContent(
  content: unknown,
  toolName: string,
  trustedControlChannel?: boolean,
): unknown {
  if (trustedControlChannel) return content
  const source = `mcp ${toolName}`
  if (typeof content === 'string') {
    return wrapUntrusted(content, source).wrapped
  }
  if (!Array.isArray(content)) return content
  return content.map(block => {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'text' &&
      typeof (block as { text?: string }).text === 'string'
    ) {
      return {
        ...block,
        text: wrapUntrusted((block as { text: string }).text, source).wrapped,
      }
    }
    return block
  })
}

export const MCPTool = buildTool({
  isMcp: true,
  // Overridden in mcpClient.ts with the real MCP tool name + args
  isOpenWorld() {
    return false
  },
  // Overridden in mcpClient.ts
  name: 'mcp',
  maxResultSizeChars: 100_000,
  // Overridden in mcpClient.ts
  async description() {
    return DESCRIPTION
  },
  // Overridden in mcpClient.ts
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  // Overridden in mcpClient.ts
  async call() {
    return {
      data: '',
    }
  },
  async checkPermissions(): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: 'MCPTool requires permission.',
    }
  },
  renderToolUseMessage,
  // Overridden in mcpClient.ts
  userFacingName: () => 'mcp',
  renderToolUseProgressMessage,
  renderToolResultMessage,
  isResultTruncated(output: Output): boolean {
    return isOutputLineTruncated(output)
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    // An MCP server returns third-party text: a GitHub issue body, a Jira
    // comment, a scraped page. Same trust class as a web fetch and the
    // highest-volume untrusted channel UR has, so it gets the same
    // nonce-bound boundary. `this.name` is the server-qualified name set in
    // client.ts, not the 'mcp' placeholder above.
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: wrapMcpContent(content, this.name, this.trustedControlChannel),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
