import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addResearchFinding,
  addResearchQuestion,
  addResearchSource,
  auditResearchProject,
  createResearchProject,
  loadResearchProject,
  renderResearchReport,
  sanitizeResearchUrl,
  writeResearchReport,
} from '../src/services/research/researchWorkspace.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ur-research-workspace-'))
}

describe('research workspaces', () => {
  test('stores sources/findings and verifies independent corroboration', () => {
    const root = tempDir()
    createResearchProject(root, 'agent-trends', 'Which agent capabilities are current?')
    const first = addResearchSource(root, 'agent-trends', {
      url: 'https://example.com/a?token=secret',
      title: 'Primary specification',
      publisher: 'Example Standards',
    })
    const second = addResearchSource(root, 'agent-trends', {
      url: 'https://docs.example.org/b',
      title: 'Implementation documentation',
      publisher: 'Independent Project',
    })
    addResearchFinding(root, 'agent-trends', {
      text: 'The capability is implemented by two independent projects.',
      sourceIds: [first.id, second.id],
      confidence: 'high',
    })
    addResearchQuestion(root, 'agent-trends', 'How stable is the prerelease protocol?')

    const project = loadResearchProject(root, 'agent-trends')
    const audit = auditResearchProject(project)
    expect(project.sources[0]!.url).toContain('token=%5Bredacted%5D')
    expect(audit.valid).toBe(true)
    expect(audit.ready).toBe(true)
    expect(audit.openQuestionCount).toBe(1)
    expect(renderResearchReport(project)).toContain('[S1]')
    rmSync(root, { recursive: true, force: true })
  })

  test('rejects uncited supported findings and warns on weak high confidence', () => {
    const root = tempDir()
    createResearchProject(root, 'weak-proof', 'Is this proven?')
    addResearchSource(root, 'weak-proof', { url: 'https://example.com/only', title: 'Only source' })
    addResearchFinding(root, 'weak-proof', { text: 'Uncited.', confidence: 'medium' })
    addResearchFinding(root, 'weak-proof', { text: 'Weakly corroborated.', sourceIds: ['S1'], confidence: 'high' })
    const audit = auditResearchProject(loadResearchProject(root, 'weak-proof'))
    expect(audit.valid).toBe(false)
    expect(audit.issues.map(issue => issue.code)).toContain('UNCITED_FINDING')
    expect(audit.issues.map(issue => issue.code)).toContain('HIGH_CONFIDENCE_NOT_CORROBORATED')
    rmSync(root, { recursive: true, force: true })
  })

  test('sanitizes credentials and confines report output', () => {
    expect(sanitizeResearchUrl('https://user:pass@example.com/path?api_key=abc&view=1#secret'))
      .toBe('https://example.com/path?api_key=%5Bredacted%5D&view=1')
    const root = tempDir()
    const out = writeResearchReport(root, 'docs/research/demo.md', '# Demo\n')
    expect(existsSync(out)).toBe(true)
    expect(readFileSync(out, 'utf8')).toBe('# Demo\n')
    expect(() => writeResearchReport(root, '../escape.md', 'no')).toThrow('inside the workspace')
    rmSync(root, { recursive: true, force: true })
  })

  test('research command supports the full source-backed lifecycle', async () => {
    const root = tempDir()
    const { call } = await import('../src/commands/research/research.js')
    await runWithCwdOverride(root, () => call('init demo --question "What changed?"', {} as never))
    await runWithCwdOverride(root, () => call('source demo --url https://example.com --title "Official source"', {} as never))
    await runWithCwdOverride(root, () => call('finding demo --text "A change shipped." --cite S1', {} as never))
    const result = await runWithCwdOverride(root, () => call('show demo --json', {} as never))
    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text')
    const parsed = JSON.parse(result.value)
    expect(parsed.project.findings).toHaveLength(1)
    expect(parsed.digest).toMatch(/^[a-f0-9]{64}$/)
    rmSync(root, { recursive: true, force: true })
  })
})
