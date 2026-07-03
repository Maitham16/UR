import { describe, expect, test } from 'bun:test'
import type { ProviderOption, RecommendationCategory } from '../bridge/types.js'
import { buildRecommendations, recommendationForCategory } from './agentOptions.js'

const SUBSCRIPTION_BOUNDARY =
  'External vendor CLI boundary: UR passes prompt text to the official CLI and receives final text output. UR-native tool calling, UR Bash/File tool execution, UR-native streaming, local command permissions, sandbox guarantees, and verifier/done-gate checks apply to UR-run tools/final UR output, not to actions the external CLI performs internally.'

const FIXTURE_OPTIONS: ProviderOption[] = [
  {
    id: 'anthropic-api',
    displayName: 'Claude API',
    providerKind: 'ur-native',
    accessType: 'api',
    usesExternalCli: false,
    supportsNativeToolCalls: true,
    supportsNativeStreaming: true,
    multimodal: true,
    safetyBoundaryLabel: 'UR-native runtime: UR owns provider request shaping...',
  },
  {
    id: 'ollama',
    displayName: 'Ollama',
    providerKind: 'ur-native',
    accessType: 'local',
    usesExternalCli: false,
    supportsNativeToolCalls: true,
    supportsNativeStreaming: true,
    multimodal: 'unknown',
    safetyBoundaryLabel: 'UR-native runtime: UR owns provider request shaping...',
  },
  {
    id: 'claude-code-cli',
    displayName: 'Claude Code',
    providerKind: 'subscription-cli',
    accessType: 'subscription',
    usesExternalCli: true,
    supportsNativeToolCalls: false,
    supportsNativeStreaming: false,
    multimodal: false,
    safetyBoundaryLabel: SUBSCRIPTION_BOUNDARY,
  },
]

describe('buildRecommendations', () => {
  test('produces all nine required categories', () => {
    const recommendations = buildRecommendations(FIXTURE_OPTIONS)
    const categories = recommendations.map(r => r.category).sort()
    const expected: RecommendationCategory[] = [
      'complex-refactor',
      'docs-review',
      'local-offline',
      'multimodal',
      'native-streaming',
      'privacy',
      'speed',
      'subscription-cli-access',
      'tool-calling',
    ]
    expect(categories).toEqual(expected.sort())
  })

  test('privacy and local-offline recommend only local/server providers', () => {
    const recommendations = buildRecommendations(FIXTURE_OPTIONS)
    expect(recommendationForCategory(recommendations, 'privacy')?.recommendedProviderIds).toEqual(['ollama'])
    expect(recommendationForCategory(recommendations, 'local-offline')?.recommendedProviderIds).toEqual(['ollama'])
  })

  test('multimodal only recommends providers curated as true, never the unknown ones', () => {
    const recommendations = buildRecommendations(FIXTURE_OPTIONS)
    const multimodal = recommendationForCategory(recommendations, 'multimodal')
    expect(multimodal?.recommendedProviderIds).toEqual(['anthropic-api'])
    expect(multimodal?.recommendedProviderIds).not.toContain('ollama')
    expect(multimodal?.recommendedProviderIds).not.toContain('claude-code-cli')
  })

  test('tool-calling and native-streaming exclude subscription CLI providers', () => {
    const recommendations = buildRecommendations(FIXTURE_OPTIONS)
    const toolCalling = recommendationForCategory(recommendations, 'tool-calling')
    const streaming = recommendationForCategory(recommendations, 'native-streaming')
    expect(toolCalling?.recommendedProviderIds).not.toContain('claude-code-cli')
    expect(streaming?.recommendedProviderIds).not.toContain('claude-code-cli')
    expect(toolCalling?.recommendedProviderIds.sort()).toEqual(['anthropic-api', 'ollama'].sort())
  })

  test('subscription-cli-access recommends subscription CLI providers and carries the real boundary wording', () => {
    const recommendations = buildRecommendations(FIXTURE_OPTIONS)
    const subCli = recommendationForCategory(recommendations, 'subscription-cli-access')
    expect(subCli?.recommendedProviderIds).toEqual(['claude-code-cli'])
    expect(subCli?.caveat).toContain('External vendor CLI boundary')
    expect(subCli?.caveat).toContain('UR passes prompt text to the official CLI')
  })

  test('complex-refactor only recommends UR-native providers with native tool calling, and never claims model quality', () => {
    const recommendations = buildRecommendations(FIXTURE_OPTIONS)
    const refactor = recommendationForCategory(recommendations, 'complex-refactor')
    expect(refactor?.recommendedProviderIds.sort()).toEqual(['anthropic-api', 'ollama'].sort())
    expect(refactor?.rationale.toLowerCase()).not.toContain('smartest')
    expect(refactor?.rationale.toLowerCase()).not.toContain('best model')
  })

  test('docs-review does not fabricate a favored provider when there is no structural signal', () => {
    const recommendations = buildRecommendations(FIXTURE_OPTIONS)
    expect(recommendationForCategory(recommendations, 'docs-review')?.recommendedProviderIds).toEqual([])
  })

  test('no rationale claims live market research', () => {
    const recommendations = buildRecommendations(FIXTURE_OPTIONS)
    for (const r of recommendations) {
      expect(r.rationale.toLowerCase()).not.toContain('according to')
      expect(r.rationale.toLowerCase()).not.toContain('benchmark')
      expect(r.rationale.toLowerCase()).not.toContain('market research')
    }
  })

  test('handles an empty provider list without throwing', () => {
    expect(() => buildRecommendations([])).not.toThrow()
    for (const r of buildRecommendations([])) {
      expect(r.recommendedProviderIds).toEqual([])
    }
  })
})
