/** Provider-neutral discovery uses ordinary text results and ordinary schemas. */
export const TOOL_DISCOVERY_FORMAT = 'ur.tool-discovery/1'
export type PortableToolDefinition = { name: string; description: string; input_schema: Record<string, unknown> }

export function formatPortableToolDiscovery(tools: PortableToolDefinition[]): string {
  return JSON.stringify({ format: TOOL_DISCOVERY_FORMAT, tools })
}

export function parsePortableToolDiscovery(content: unknown): string[] {
  const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.flatMap((block: unknown) => record(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n') : ''
  if (!text || text.length > 1_000_000) return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (!record(parsed) || parsed.format !== TOOL_DISCOVERY_FORMAT || !Array.isArray(parsed.tools)) return []
    return [...new Set(parsed.tools.flatMap((tool: unknown) => record(tool) && typeof tool.name === 'string' && record(tool.input_schema) ? [tool.name] : []))]
  } catch { return [] }
}

/** Only visibility changes. Execution continues through the complete permission-aware registry. */
export function selectToolCatalog<T extends { name: string }>(tools: readonly T[], deferred: ReadonlySet<string>, discovered: ReadonlySet<string>): T[] {
  return tools.filter(tool => !deferred.has(tool.name) || tool.name === 'ToolSearch' || discovered.has(tool.name))
}
