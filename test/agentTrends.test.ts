import { describe, expect, test } from 'bun:test'
import {
  buildA2AAgentCard,
  buildAgentTrendReport,
  formatAgentTrendReport,
} from '../src/services/agents/trends.js'

describe('agent trend coverage', () => {
  test('exports a versioned A2A Agent Card with normalized endpoint URL', () => {
    const card = buildA2AAgentCard({ baseUrl: 'https://example.com/root/?x=1#frag' })

    expect(card.name).toBe('UR Agent')
    expect(card.version).toBe(MACRO.VERSION)
    expect(card.url).toBe('https://example.com/root/a2a')
    expect(card.documentationUrl).toContain('docs/AGENT_TRENDS.md')
    expect(card.skills.map(skill => skill.id)).toContain('coding-agent')
    expect(card.skills.map(skill => skill.id)).toContain('mcp-agent')
  })

  test('reports every tracked modern agent trend', () => {
    const report = buildAgentTrendReport()
    const ids = report.coverage.map(item => item.id)

    expect(report.urVersion).toBe(MACRO.VERSION)
    expect(ids).toContain('local-runtime')
    expect(ids).toContain('mcp')
    expect(ids).toContain('a2a')
    expect(ids).toContain('durable-workflows')
    expect(ids).toContain('multi-agent')
    expect(ids).toContain('memory')
    expect(ids).toContain('browser-computer-use')
    expect(ids).toContain('provenance')
    expect(ids).toContain('evals-observability')
    expect(ids).toContain('security')
    expect(ids).toContain('identity-auth')
    expect(ids).toContain('multimodal')
    expect(report.coverage.every(item => item.references.length > 0)).toBe(true)
  })

  test('formats a human-readable professional report', () => {
    const text = formatAgentTrendReport(buildAgentTrendReport())

    expect(text).toContain('UR Agent Trend Coverage')
    expect(text).toContain('[covered] Local-first model runtime')
    expect(text).toContain('[covered] MCP tool ecosystem')
    expect(text).toContain('[adapter-ready] A2A / Agent Card interoperability')
    expect(text).toContain('References:')
    expect(text).toContain('Priority Roadmap')
  })
})
