import { describe, expect, test } from 'bun:test'
import {
  buildA2AAgentCard,
  buildAgentTrendReport,
  formatAgentTrendReport,
} from '../src/services/agents/trends.js'

describe('agent trend coverage', () => {
  test('exports a versioned A2A Agent Card with normalized endpoint URL', () => {
    const card = buildA2AAgentCard({ baseUrl: 'https://example.com/root/?x=1#frag' })

    expect(card.name).toBe('UR')
    expect(card.version).toBe(MACRO.VERSION)
    expect(card.url).toBe('https://example.com/root/a2a/jsonrpc')
    expect(card.preferredTransport).toBe('JSONRPC')
    expect(card.additionalInterfaces).toEqual([
      { url: 'https://example.com/root/a2a/jsonrpc', transport: 'JSONRPC' },
    ])
    expect(card.documentationUrl).toContain('docs/AGENT_TRENDS.md')
    expect(card.capabilities.streaming).toBe(false)
    expect(card.skills.map(skill => skill.id)).toContain('coding-agent')
    expect(card.skills.map(skill => skill.id)).toContain('mcp-agent')
  })

  test('reports every tracked modern agent trend', () => {
    const report = buildAgentTrendReport()
    const ids = report.coverage.map(item => item.id)

    expect(report.urVersion).toBe(MACRO.VERSION)
    expect(report.researchSnapshotDate).toBe('2026-07-15')
    expect(ids).toContain('local-runtime')
    expect(ids).toContain('mcp')
    expect(ids).toContain('mcp-async-apps')
    expect(ids).toContain('a2a')
    expect(ids).toContain('acp')
    expect(ids).toContain('ag-ui')
    expect(ids).toContain('durable-workflows')
    expect(ids).toContain('multi-agent')
    expect(ids).toContain('memory')
    expect(ids).toContain('agent-skills')
    expect(ids).toContain('browser-computer-use')
    expect(ids).toContain('provenance')
    expect(ids).toContain('evals-observability')
    expect(ids).toContain('genai-telemetry')
    expect(ids).toContain('test-first-execution')
    expect(ids).toContain('permission-safety')
    expect(ids).toContain('context-management')
    expect(ids).toContain('security')
    expect(ids).toContain('identity-auth')
    expect(ids).toContain('multimodal')
    expect(ids).toContain('provider-native-runtime')
    expect(report.coverage.every(item => item.references.length > 0)).toBe(true)
  })

  test('formats a human-readable professional report', () => {
    const text = formatAgentTrendReport(buildAgentTrendReport())

    expect(text).toContain('UR Trend Coverage')
    expect(text).toContain('[covered] Provider-flexible, local-first model runtime')
    expect(text).toContain('[covered] MCP tool ecosystem')
    expect(text).toContain('[covered] A2A / Agent Card interoperability')
    expect(text).toContain(
      '[covered] AG-UI agent-to-frontend interoperability',
    )
    expect(text).toContain('References:')
    expect(text).toContain('Priority Roadmap')
    expect(text).toContain('Research snapshot: 2026-07-15')
  })
})
