import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { EXECUTION_CONTRACT_SECTION } from '../src/constants/executionContract.js'
import {
  FINAL_RESPONSE_CONTRACT,
  PROMPT_PROFILES,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  analyzeRenderedPrompt,
  renderGovernedPrompt,
  type PromptProfile,
} from '../src/constants/promptGovernance.js'
import { CURRENT_PROMPT_LIFECYCLE } from '../src/constants/promptLifecycle.js'
import {
  getEvalProvenanceSnapshot,
  recordEvalConfiguration,
  resetEvalProvenanceForTesting,
} from '../src/services/agents/evalProvenance.js'

function renderProfile(
  profile: PromptProfile,
  dynamic = 'runtime context A',
): string[] {
  return renderGovernedPrompt(profile, [
    `# Role\nUR ${profile} profile`,
    EXECUTION_CONTRACT_SECTION,
    profile === 'ollama'
      ? '# Ollama tool discipline\nUse native structured tool calls.'
      : null,
    '# Final response\n' + FINAL_RESPONSE_CONTRACT,
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    `# Runtime context\n${dynamic}`,
    profile === 'custom-overlay'
      ? '# Custom Agent Instructions\nReview only the requested files.'
      : null,
  ])
}

describe('rendered prompt governance', () => {
  test('all supported profiles have one kernel and a compact, consistent contract', () => {
    expect(CURRENT_PROMPT_LIFECYCLE.supportedProfiles).toEqual([
      ...PROMPT_PROFILES,
    ])

    for (const profile of PROMPT_PROFILES) {
      const rendered = renderProfile(profile)
      const analysis = analyzeRenderedPrompt(profile, rendered)
      expect(analysis.executionContractCount).toBe(1)
      expect(analysis.dynamicBoundaryCount).toBe(1)
      expect(analysis.exactDuplicateSections).toEqual([])
      expect(analysis.duplicateHeadings).toEqual([])
      expect(analysis.contradictions).toEqual([])
      expect(analysis.withinBudget).toBe(true)
      expect(rendered.join('\n')).toContain(FINAL_RESPONSE_CONTRACT)
    }
  })

  test('governed rendering removes an exact duplicate kernel', () => {
    const rendered = renderGovernedPrompt('default', [
      EXECUTION_CONTRACT_SECTION,
      '# Domain instructions',
      EXECUTION_CONTRACT_SECTION,
    ])
    expect(
      rendered.filter(section => section === EXECUTION_CONTRACT_SECTION),
    ).toHaveLength(1)
  })

  test('dynamic context cannot change the stable-prefix fingerprint', () => {
    for (const profile of PROMPT_PROFILES) {
      const first = analyzeRenderedPrompt(profile, renderProfile(profile, 'A'))
      const second = analyzeRenderedPrompt(profile, renderProfile(profile, 'B'))
      expect(first.stablePrefixHash).toBe(second.stablePrefixHash)

      const changedStatic = renderProfile(profile, 'B')
      changedStatic[0] += ' changed'
      expect(
        analyzeRenderedPrompt(profile, changedStatic).stablePrefixHash,
      ).not.toBe(first.stablePrefixHash)
    }
  })

  test('runtime branches use the governed renderer and shared final contract', () => {
    const prompts = readFileSync('src/constants/prompts.ts', 'utf8')
    const overlays = readFileSync('src/utils/systemPrompt.ts', 'utf8')
    expect(prompts).toContain("renderGovernedPrompt('simple'")
    expect(prompts).toContain("renderGovernedPrompt('proactive'")
    expect(prompts).toContain("? 'ollama' : 'default'")
    expect(overlays).toContain("renderGovernedPrompt('custom-overlay'")
    expect(prompts.match(/\$\{FINAL_RESPONSE_CONTRACT\}/g)).toHaveLength(2)
  })

  test('diagnostic reports duplicate and contradictory prompt clauses', () => {
    const rendered = renderGovernedPrompt('default', [
      '# Repeated\nSame rule.',
      '# Repeated\nSame rule.',
      'Only run tests if the user confirms.',
      'Run relevant tests without asking.',
    ])
    const analysis = analyzeRenderedPrompt('default', rendered)
    expect(analysis.exactDuplicateSections).toHaveLength(1)
    expect(analysis.duplicateHeadings).toEqual(['# repeated'])
    expect(analysis.contradictions).toContain(
      'tests require confirmation and should run autonomously',
    )
  })
})

describe('semantic prompt provenance', () => {
  test('records lifecycle metadata and hashes without recording prompt text', () => {
    resetEvalProvenanceForTesting()
    recordEvalConfiguration({
      systemPrompt: ['PRIVATE PROMPT CONTENT'],
      toolSchemas: [{ name: 'Read' }],
      contextPolicy: { dynamicTail: true },
      modelConfig: { model: 'fixture', effort: 'medium' },
    })

    const snapshot = getEvalProvenanceSnapshot()
    expect(snapshot.promptLifecycles).toEqual([CURRENT_PROMPT_LIFECYCLE])
    expect(snapshot.promptLifecycles[0]?.promptVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(snapshot.promptLifecycles[0]?.evalSuiteId).toBe(
      'prompt-platform-2026',
    )
    expect(snapshot.promptLifecycles[0]?.rolloutId).toBeTruthy()
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE PROMPT CONTENT')
    expect(snapshot.promptHashes).toHaveLength(1)
  })
})
