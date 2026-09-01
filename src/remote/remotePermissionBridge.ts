import { randomUUID } from 'crypto'
import { z } from 'zod/v4'
import type { SDKControlPermissionRequest } from '../entrypoints/sdk/controlTypes.js'
import { buildTool, type Tool, type ToolDef } from '../Tool.js'
import type { AssistantMessage } from '../types/message.js'
import { jsonStringify } from '../utils/slowOperations.js'

const remoteToolInputSchema = z.record(z.string(), z.unknown())
const remoteToolOutputSchema = z.string()

/**
 * Create a synthetic AssistantMessage for remote permission requests.
 * The ToolUseConfirm type requires an AssistantMessage, but in remote mode
 * we don't have a real one — the tool use runs on the CCR container.
 */
export function createSyntheticAssistantMessage(
  request: SDKControlPermissionRequest,
  requestId: string,
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    message: {
      id: `remote-${requestId}`,
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: request.tool_use_id,
          name: request.tool_name,
          input: request.input,
        },
      ],
      model: '',
      stop_reason: null,
      stop_sequence: null,
      container: null,
      context_management: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as AssistantMessage['message'],
    requestId: undefined,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create a minimal Tool stub for tools that aren't loaded locally.
 * This happens when the remote CCR has tools (e.g., MCP tools) that the
 * local CLI doesn't know about. The stub routes to FallbackPermissionRequest.
 */
export function createToolStub(toolName: string): Tool {
  return buildTool({
    name: toolName,
    inputSchema: remoteToolInputSchema,
    outputSchema: remoteToolOutputSchema,
    permissionRequestKind: 'fallback',
    maxResultSizeChars: 100_000,
    isEnabled: () => true,
    userFacingName: () => toolName,
    renderToolUseMessage: (input: Record<string, unknown>) => {
      const entries = Object.entries(input)
      if (entries.length === 0) return ''
      return entries
        .slice(0, 3)
        .map(([key, value]) => {
          const valueStr =
            typeof value === 'string' ? value : jsonStringify(value)
          return `${key}: ${valueStr}`
        })
        .join(', ')
    },
    call: async () => ({ data: '' }),
    mapToolResultToToolResultBlockParam: (output, toolUseID) => ({
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output,
    }),
    description: async () => '',
    prompt: async () => '',
    isReadOnly: () => false,
    isMcp: false,
  } satisfies ToolDef<typeof remoteToolInputSchema, string>) as Tool
}
