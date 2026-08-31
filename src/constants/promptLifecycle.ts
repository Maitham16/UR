import { PROMPT_PROFILES } from './promptGovernance.js'

/**
 * Human-readable governance metadata for the privileged prompt contract.
 *
 * Keep this separate from the rendered prompt: eval artifacts and telemetry may
 * record these identifiers and prompt hashes, but never the prompt text itself.
 */
export type PromptLifecycleMetadata = {
  /** Semver for behaviorally meaningful prompt-contract changes. */
  promptVersion: string
  /** Why this version exists; not a copy of the prompt. */
  rationale: string
  /** Guidance or decision records used to design this version. */
  sources: Array<{
    title: string
    url?: string
    accessedAt?: string
  }>
  /** Runtime prompt shapes covered by the governance contract. */
  supportedProfiles: string[]
  /** Canonical regression suite used to qualify this version. */
  evalSuiteId: string
  /** Stable rollout identifier for correlating eval artifacts. */
  rolloutId: string
}

export const CURRENT_PROMPT_LIFECYCLE: Readonly<PromptLifecycleMetadata> =
  Object.freeze({
    promptVersion: '1.0.0',
    rationale:
      'Lean outcome-first agent contract with explicit completion evidence, cache-stable assembly, and governed custom-agent overlays.',
    sources: [
      {
        title: 'OpenAI GPT-5.6 prompting best practices',
        url: 'https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6#prompting-best-practices',
        accessedAt: '2026-08-31',
      },
      {
        title: 'UR prompt-platform regression suite',
      },
    ],
    supportedProfiles: [...PROMPT_PROFILES],
    evalSuiteId: 'prompt-platform-2026',
    rolloutId: 'prompt-governance-2026-08-31',
  })
