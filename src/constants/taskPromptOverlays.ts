import { getLocalISODate } from './common.js'

export type TaskPromptOverlayKind =
  | 'research'
  | 'editing'
  | 'frontend'
  | 'vision'

export type TaskPromptOverlay = {
  kind: TaskPromptOverlayKind
  instructions: string
}

const RESEARCH_ACTION =
  /\b(?:research|browse|search (?:the )?(?:web|internet)|look up|check (?:the )?(?:web|internet)|find (?:credible |reliable |official |primary )?(?:sources?|stud(?:y|ies)|papers?|evidence)|cite (?:sources?|evidence)|source (?:this|that|the answer)|literature review)\b/i
const RESEARCH_RESULT =
  /\b(?:latest|current|recent|newest|today|up[- ]to[- ]date|state of the art|stud(?:y|ies)|research|paper|evidence|sources?|citations?|release notes?|changelog)\b/i
const EXPLICIT_WEB = /\b(?:online|on the web|on the internet|internet)\b/i

const RECENCY_SENSITIVE =
  /\b(?:latest|current|recent|newest|today|now|this (?:week|month|year)|up[- ]to[- ]date|as of|recently|new release|release notes?|changelog|price|pricing|schedule|status|version|law|regulation|standard|officeholder|president|prime minister|ceo)\b/i

const EDITING_ACTION =
  /\b(?:rewrite|rephrase|revise|polish|proofread|copyedit|copy-edit|edit (?:this|the following|my)|shorten|condense|expand|translate|change the tone|make (?:this|it) (?:clearer|shorter|longer|formal|informal|professional|concise))\b/i
const EDITING_CONTENT =
  /\b(?:text|copy|prose|paragraph|sentence|document|article|post|email|letter|message|readme|bio|essay|report|description|announcement|draft|wording|tone)\b/i

const FRONTEND_ACTION =
  /\b(?:build|create|implement|design|redesign|restyle|style|fix|change|update|refine|improve|match|reproduce|make)\b/i
const FRONTEND_TARGET =
  /\b(?:front[- ]?end|ui|user interface|web ?page|website|landing page|dashboard|form|modal|dialog|menu|navbar|sidebar|component|layout|responsive|css|html|react|vue|svelte|angular|tailwind|visual design)\b/i

const IMAGE_REFERENCE = /\[Image #\d+\]/i
const VISION_ACTION =
  /\b(?:inspect|analy[sz]e|describe|read|review|compare|identify|extract|transcribe|ocr|debug|fix|match|recreate|look at|what (?:is|does|are)|can you see)\b/i
const VISION_TARGET =
  /\b(?:image|photo|picture|screenshot|scan|diagram|figure|chart|visual|mockup|wireframe)\b/i

function matchesResearchTask(input: string): boolean {
  return (
    RESEARCH_ACTION.test(input) ||
    (EXPLICIT_WEB.test(input) && RESEARCH_RESULT.test(input))
  )
}

function matchesEditingTask(input: string): boolean {
  if (EDITING_ACTION.test(input) && EDITING_CONTENT.test(input)) return true

  // Deictic rewrite requests commonly carry the actual text after a colon or
  // newline, so requiring a noun would incorrectly miss the most direct form.
  return /\b(?:rewrite|rephrase|proofread|polish) (?:this|it|the following)\b/i.test(
    input,
  )
}

function matchesFrontendTask(input: string): boolean {
  return FRONTEND_ACTION.test(input) && FRONTEND_TARGET.test(input)
}

function matchesVisionTask(input: string): boolean {
  return (
    IMAGE_REFERENCE.test(input) ||
    (VISION_ACTION.test(input) && VISION_TARGET.test(input))
  )
}

function currentYear(): string {
  return getLocalISODate().slice(0, 4)
}

/**
 * Resolve narrow, per-turn contracts from the user's actual request. These
 * overlays deliberately live after the stable system-prompt prefix so an
 * unrelated task pays no token or cache cost.
 */
export function resolveTaskPromptOverlays(
  input: string,
  options: { currentYear?: string } = {},
): TaskPromptOverlay[] {
  const overlays: TaskPromptOverlay[] = []

  if (matchesResearchTask(input)) {
    const recencyInstruction = RECENCY_SENSITIVE.test(input)
      ? `This request is recency-sensitive: use ${options.currentYear ?? currentYear()} in searches when it helps disambiguate current results, and verify dates or versions.`
      : 'This request is not inherently recency-sensitive: do not add a current year to queries unless a fact you encounter is temporally unstable.'
    overlays.push({
      kind: 'research',
      instructions: `Research contract: support externally verifiable claims with claim-adjacent links to the sources that establish them. Clearly label inference rather than presenting it as a sourced fact. Reconcile conflicting sources by comparing date, scope, definitions, and methodology. If evidence is absent, state what was searched and that non-discovery is not proof of absence. Stop once primary evidence and enough independent corroboration answer the question; continue only for a material unresolved conflict or gap. ${recencyInstruction}`,
    })
  }

  if (matchesEditingTask(input)) {
    overlays.push({
      kind: 'editing',
      instructions:
        'Editing contract: preserve the source meaning, factual claims, voice, audience, formatting, and constraints except where the user explicitly asks for change. Do not invent supporting facts or silently broaden the rewrite. Return a clean revision and surface only ambiguities that materially affect it.',
    })
  }

  if (matchesFrontendTask(input)) {
    overlays.push({
      kind: 'frontend',
      instructions:
        'Frontend contract: after changing the interface, render or run the relevant view and inspect the visible result at the important viewport and interaction states. Iterate on discrepancies you observe. Do not claim the UI is complete from source inspection or unit tests alone, and preserve the established visual language unless the user requested a redesign.',
    })
  }

  if (matchesVisionTask(input)) {
    overlays.push({
      kind: 'vision',
      instructions:
        'Vision contract: inspect at the detail level the task requires. Use high or original detail for fine text, small controls, visual defects, measurements, or comparisons; re-open, zoom, or crop when the available tool supports it. Distinguish what is visibly observed from inference, and do not guess at illegible or occluded details.',
    })
  }

  return overlays
}

export function renderTaskPromptOverlay(overlays: TaskPromptOverlay[]): string {
  return overlays
    .map(overlay => overlay.instructions)
    .join('\n\n')
}
