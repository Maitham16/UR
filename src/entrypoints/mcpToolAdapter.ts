import type {
  CallToolResult,
  Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js'
import type {
  Tool as UrTool,
  ToolPermissionContext,
  ToolResult,
  Tools,
} from '../Tool.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { zodToJsonSchema } from '../utils/zodToJsonSchema.js'

function issuePath(path: PropertyKey[]): string {
  if (path.length === 0) return '<root>'
  return path.map(String).join('.')
}

function formatIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map(issue => `${issuePath(issue.path)}: ${issue.message}`)
    .join('; ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function parseMcpToolArguments(
  tool: UrTool,
  input: unknown,
  maxInputChars = Number.POSITIVE_INFINITY,
): Promise<Record<string, unknown>> {
  const candidate = input ?? {}
  const serializedInput = jsonStringify(candidate)
  if (serializedInput.length > maxInputChars) {
    throw new Error(
      `Tool ${tool.name} received ${serializedInput.length} input characters, exceeding the MCP input limit of ${maxInputChars}`,
    )
  }

  const result = await tool.inputSchema.safeParseAsync(candidate)
  if (!result.success) {
    throw new Error(formatIssues(result.error.issues))
  }
  return result.data
}

export async function describeMcpTool(
  tool: UrTool,
  tools: Tools,
  toolPermissionContext: ToolPermissionContext,
): Promise<McpTool> {
  let outputSchema: McpTool['outputSchema']
  if (tool.outputSchema) {
    const converted = zodToJsonSchema(tool.outputSchema)
    if (
      typeof converted === 'object' &&
      converted !== null &&
      'type' in converted &&
      converted.type === 'object'
    ) {
      outputSchema = converted as McpTool['outputSchema']
    }
  }

  const inputSchema = tool.inputJSONSchema
    ? tool.inputJSONSchema
    : zodToJsonSchema(tool.inputSchema)

  return {
    name: tool.name,
    description: await tool.prompt({
      getToolPermissionContext: async () => toolPermissionContext,
      tools,
      agents: [],
    }),
    inputSchema: inputSchema as McpTool['inputSchema'],
    ...(outputSchema ? { outputSchema } : {}),
  }
}

export async function formatMcpToolResult(
  tool: UrTool,
  result: ToolResult<unknown>,
  maxOutputChars: number,
): Promise<CallToolResult> {
  let structuredContent = result.mcpMeta?.structuredContent

  if (tool.outputSchema) {
    const candidate = structuredContent ?? result.data
    const parsed = await tool.outputSchema.safeParseAsync(candidate)
    if (!parsed.success) {
      throw new Error(
        `Tool ${tool.name} returned output that does not match its schema: ${formatIssues(parsed.error.issues)}`,
      )
    }
    if (!isRecord(parsed.data)) {
      throw new Error(
        `Tool ${tool.name} declares an object output schema but returned a non-object value`,
      )
    }
    structuredContent = parsed.data
  }

  const text =
    typeof result.data === 'string'
      ? result.data
      : jsonStringify(result.data)
  const structuredText = structuredContent
    ? jsonStringify(structuredContent)
    : ''
  const metadataText = result.mcpMeta?._meta
    ? jsonStringify(result.mcpMeta._meta)
    : ''
  const responseChars = text.length + structuredText.length + metadataText.length

  if (responseChars > maxOutputChars) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Tool ${tool.name} returned ${responseChars} protocol characters, exceeding the MCP output limit of ${maxOutputChars}. Narrow the request and try again.`,
        },
      ],
    }
  }

  return {
    content: [{ type: 'text', text }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(result.mcpMeta?._meta ? { _meta: result.mcpMeta._meta } : {}),
  }
}
