import { createHash } from 'node:crypto'
import {
  EXECUTION_CONTRACT_SECTION,
  ensureExecutionContract,
} from './executionContract.js'

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'

export const PROMPT_PROFILES = [
  'default',
  'simple',
  'proactive',
  'ollama',
  'custom-overlay',
] as const

export type PromptProfile = (typeof PROMPT_PROFILES)[number]

/** Core-prompt budgets exclude user input and retrieved/session context. */
export const PROMPT_PROFILE_WORD_BUDGETS: Record<PromptProfile, number> = {
  default: 5_000,
  simple: 350,
  proactive: 2_500,
  ollama: 5_200,
  'custom-overlay': 5_500,
}
export const FINAL_RESPONSE_CONTRACT =
  'Lead the final response with the outcome. Include the material evidence needed to support it, any caveat that changes the result, and the next action when one is relevant. Keep all required facts, decisions, caveats, and next steps; trim introductions, repetition, generic reassurance, and optional background first.'

/**
 * Canonical assembly used by every runtime prompt profile. It preserves the
 * caller's section order while guaranteeing one platform execution contract.
 */
export function renderGovernedPrompt(
  _profile: PromptProfile,
  sections: Array<string | null | undefined>,
): string[] {
  return ensureExecutionContract(
    sections.filter((section): section is string => Boolean(section)),
  )
}

export type PromptContractAnalysis = {
  profile: PromptProfile
  wordCount: number
  wordBudget: number
  withinBudget: boolean
  executionContractCount: number
  dynamicBoundaryCount: number
  exactDuplicateSections: string[]
  duplicateHeadings: string[]
  contradictions: string[]
  stablePrefixHash: string
}

const CONTRADICTORY_RULES = [
  {
    label: 'tests require confirmation and should run autonomously',
    left: /only run (?:them|tests) if the user confirms/i,
    right:
      /run (?:the )?(?:most )?relevant (?:non-destructive )?(?:validation|tests).*without asking/i,
  },
  {
    label: 'full-suite verification is both prohibited and required',
    left: /do not automatically run the full project test suite/i,
    right: /always run the full project test suite/i,
  },
] as const

function normalizedSection(section: string): string {
  return section.replace(/\s+/g, ' ').trim().toLowerCase()
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort()
}

/** Pure diagnostic used by regression tests and release tooling. */
export function analyzeRenderedPrompt(
  profile: PromptProfile,
  sections: string[],
): PromptContractAnalysis {
  const boundaryIndex = sections.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  const coreSections = (
    boundaryIndex === -1 ? sections : sections.slice(0, boundaryIndex)
  ).filter(section => section !== SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  const joined = sections.join('\n\n')
  const normalizedSections = coreSections
    .map(normalizedSection)
    .filter(Boolean)
  const headings = coreSections.flatMap(section =>
    section
      .split('\n')
      .filter(line => /^#{1,6}\s+\S/.test(line.trim()))
      .map(line => normalizedSection(line)),
  )
  const wordCount = coreSections.join(' ').split(/\s+/).filter(Boolean).length
  const wordBudget = PROMPT_PROFILE_WORD_BUDGETS[profile]

  return {
    profile,
    wordCount,
    wordBudget,
    withinBudget: wordCount <= wordBudget,
    executionContractCount: sections.filter(
      section => section === EXECUTION_CONTRACT_SECTION,
    ).length,
    dynamicBoundaryCount: sections.filter(
      section => section === SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    ).length,
    exactDuplicateSections: duplicates(normalizedSections),
    duplicateHeadings: duplicates(headings),
    contradictions: CONTRADICTORY_RULES.filter(
      rule => rule.left.test(joined) && rule.right.test(joined),
    ).map(rule => rule.label),
    stablePrefixHash: createHash('sha256')
      .update(coreSections.join('\n\n'))
      .digest('hex'),
  }
}
