import { expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { ToolSearchTool } from '../src/tools/ToolSearchTool/ToolSearchTool.js'
import { extractDiscoveredToolNames, isToolSearchEnabled, supportsToolReferenceExpansion } from '../src/utils/toolSearch.js'
import { formatPortableToolDiscovery, parsePortableToolDiscovery, selectToolCatalog } from '../src/utils/portableToolDiscovery.js'
import { getEmptyToolPermissionContext } from '../src/Tool.js'

function fixtureTools(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `mcp__fixture__operation_${i}`, isMcp: true,
    inputSchema: z.object({ value: z.string(), count: z.number() }),
    searchHint: `fixture operation ${i}`,
    prompt: async () => `Operation ${i}: ${'A real schema can have lengthy API explanations. '.repeat(50)}`,
  }))
}

test('portable discovery returns real ordinary JSON schemas without unsupported provider beta blocks', async () => {
  const tools = fixtureTools(100)
  const context = { options: { tools, agentDefinitions: { activeAgents: [] } }, getAppState: () => ({ mcp: { clients: [] }, toolPermissionContext: getEmptyToolPermissionContext() }) }
  const result = await ToolSearchTool.call({ query: 'select:mcp__fixture__operation_77', max_results: 5 }, context as never)
  if (!result || !('data' in result)) throw new Error('Expected tool data')
  expect(result.data.matches).toEqual(['mcp__fixture__operation_77'])
  const block = ToolSearchTool.mapToolResultToToolResultBlockParam(result.data, 'discovery-call')
  expect(typeof block.content).toBe('string')
  expect(JSON.stringify(block)).not.toContain('tool_reference')
  expect(JSON.stringify(block)).not.toContain('defer_loading')
  expect(parsePortableToolDiscovery(block.content)).toEqual(['mcp__fixture__operation_77'])
  const definition = JSON.parse(block.content as string).tools[0]
  expect(definition.input_schema.properties.count.type).toBe('number')
  expect(supportsToolReferenceExpansion()).toBe(false)
})

test('selected schemas survive history and compaction without granting execution permission', () => {
  const text = formatPortableToolDiscovery([{ name: 'mcp__example__read', description: 'Read', input_schema: { type: 'object' } }])
  const history = [{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'search', content: text }] } }] as never
  expect([...extractDiscoveredToolNames(history)]).toEqual(['mcp__example__read'])
  const compacted = [{ type: 'system', subtype: 'compact_boundary', compactMetadata: { preCompactDiscoveredTools: ['mcp__example__read'] } }] as never
  expect([...extractDiscoveredToolNames(compacted)]).toEqual(['mcp__example__read'])
  const read = { name: 'mcp__example__read', permission: 'ask' }
  const tools = [{ name: 'ToolSearch', permission: 'allow' }, read]
  const selected = selectToolCatalog(tools, new Set([read.name]), new Set([read.name, 'unavailable-tool']))
  expect(selected[1]).toBe(read)
  expect(selected[1]!.permission).toBe('ask')
  expect(selected).toHaveLength(2)
})

test('failed and malformed discovery results cannot seed the catalog', () => {
  const text = formatPortableToolDiscovery([{ name: 'private', description: '', input_schema: {} }])
  const failed = [{ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: text }] } }] as never
  expect(extractDiscoveredToolNames(failed).size).toBe(0)
  expect(parsePortableToolDiscovery('{bad json')).toEqual([])
  expect(parsePortableToolDiscovery('{"format":"other","tools":[{"name":"private"}]}')).toEqual([])
})

test('100-tool catalog measures material prompt reduction while keeping discovery available', async () => {
  const tools = [{ name: 'ToolSearch', prompt: async () => 'Discover tools', inputSchema: z.object({ query: z.string() }) }, ...fixtureTools(100)]
  const deferred = new Set(tools.slice(1).map(tool => tool.name))
  const before = JSON.stringify(await Promise.all(tools.map(async tool => ({ name: tool.name, description: await tool.prompt(), input_schema: tool.inputSchema.toJSONSchema() })))).length
  const selected = selectToolCatalog(tools, deferred, new Set([tools[78]!.name]))
  const after = JSON.stringify(await Promise.all(selected.map(async tool => ({ name: tool.name, description: await tool.prompt(), input_schema: tool.inputSchema.toJSONSchema() })))).length
  expect(selected.map(tool => tool.name)).toEqual(['ToolSearch', tools[78]!.name])
  expect(after / before).toBeLessThan(0.05)
  expect(await isToolSearchEnabled('fixture-model', tools as never, async () => getEmptyToolPermissionContext(), [])).toBe(true)
  console.info(JSON.stringify({ fixture: '100-tool-catalog', fullSchemaCharacters: before, selectedSchemaCharacters: after, retainedFraction: after / before }))
})
