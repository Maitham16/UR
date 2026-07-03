// Local/curated recommendation logic for the Agent Options panel. Every
// recommendation is derived from fields already on ProviderOption — real
// values from `ur provider list --json` plus the curated multimodal table in
// providerKnowledge.ts. Nothing here calls out to the network or claims live
// market research; it is a fixed, auditable ruleset over local/CLI data.

import type { CategoryRecommendation, ProviderOption, RecommendationCategory } from '../bridge/types.js'

function ids(options: ProviderOption[]): string[] {
  return options.map(o => o.id)
}

function isLocalOrServer(option: ProviderOption): boolean {
  return option.accessType === 'local' || option.accessType === 'server'
}

export function buildRecommendations(options: ProviderOption[]): CategoryRecommendation[] {
  const local = options.filter(isLocalOrServer)
  const nativeStreaming = options.filter(o => o.supportsNativeStreaming)
  const multimodal = options.filter(o => o.multimodal === true)
  const toolCalling = options.filter(o => o.supportsNativeToolCalls)
  const subscriptionCli = options.filter(o => o.providerKind === 'subscription-cli')
  const refactorCapable = options.filter(o => o.providerKind === 'ur-native' && o.supportsNativeToolCalls)

  const recommendations: CategoryRecommendation[] = [
    {
      category: 'privacy',
      title: 'Privacy',
      rationale: 'Local/self-hosted runtimes keep prompts, code, and responses on your machine; nothing is sent to a third-party API.',
      recommendedProviderIds: ids(local),
    },
    {
      category: 'speed',
      title: 'Speed',
      rationale: 'Local/self-hosted runtimes avoid a network round-trip per request. This reflects request path structure only — actual throughput depends on your hardware and the model you load.',
      recommendedProviderIds: ids(local),
    },
    {
      category: 'multimodal',
      title: 'Multimodal (image input)',
      rationale: 'These providers accept image content at the provider level. Local/self-hosted and OpenAI-compatible endpoints are marked unknown below since support depends on the model currently loaded, not a fixed provider fact.',
      recommendedProviderIds: ids(multimodal),
    },
    {
      category: 'tool-calling',
      title: 'Native tool calling',
      rationale: 'UR-native providers support UR-native tool-call parsing. Subscription CLI providers do not — UR passes prompt text to the external CLI and receives final text only.',
      recommendedProviderIds: ids(toolCalling),
    },
    {
      category: 'native-streaming',
      title: 'Native streaming',
      rationale: 'These providers stream tokens as they are generated. Subscription CLI providers return final text output only, with no UR-native token stream.',
      recommendedProviderIds: ids(nativeStreaming),
    },
    {
      category: 'subscription-cli-access',
      title: 'Subscription CLI access',
      rationale: 'For using an existing Codex CLI / Claude Code / Gemini CLI / Antigravity subscription through UR.',
      recommendedProviderIds: ids(subscriptionCli),
      caveat:
        subscriptionCli[0]?.safetyBoundaryLabel ??
        'External vendor CLI boundary: UR passes prompt text to the official CLI and receives final text output only.',
    },
    {
      category: 'local-offline',
      title: 'Local / offline',
      rationale: 'Runs against a local or self-hosted endpoint; works without an internet connection once the runtime and model are available on your machine.',
      recommendedProviderIds: ids(local),
    },
    {
      category: 'complex-refactor',
      title: 'Complex, multi-step refactors',
      rationale: 'Only UR-native providers with native tool calling get full UR tool-call parsing, sandbox, and verifier enforcement on every step. This is a structural capability statement, not a claim about model reasoning quality.',
      recommendedProviderIds: ids(refactorCapable),
    },
    {
      category: 'docs-review',
      title: 'Docs / review writing',
      rationale: 'Docs and review tasks are typically single-turn text generation with light tool use, so no provider is structurally favored here — use whichever provider you already have configured for chat.',
      recommendedProviderIds: [],
    },
  ]

  return recommendations
}

export function recommendationForCategory(
  recommendations: CategoryRecommendation[],
  category: RecommendationCategory,
): CategoryRecommendation | undefined {
  return recommendations.find(r => r.category === category)
}
