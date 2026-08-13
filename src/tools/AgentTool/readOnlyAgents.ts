const SHIPPED_READ_ONLY_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
])

const READ_ONLY_RESEARCH_MARKER =
  /\bread[\s-]?only\b|\b(?:do not|don't|must not|never)\s+(?:modify|write|edit|create|change)\s+(?:any\s+)?(?:code\s+)?files?\b|\bno\s+(?:file|workspace)\s+(?:changes|modifications)\b/i
const RESEARCH_INTENT_MARKER =
  /\b(?:research|investigat\w*|explor\w*|analy[sz]\w*|audit\w*)\b/i
const MUTATING_ACTION =
  '(?:implement(?:s|ed|ing)?|build(?:s|ing)?|built|create(?:s|d|ing)?|modif(?:y|ies|ied|ying)|edit(?:s|ed|ing)?|writ(?:e|es|ten|ing)|fix(?:es|ed|ing)?|refactor(?:s|ed|ing)?|update(?:s|d|ing)?|delete(?:s|d|ing)?|remove(?:s|d|ing)?|add(?:s|ed|ing)?|install(?:s|ed|ing)?|execute(?:s|d|ing)?|run(?:s|ning)?|commit(?:s|ted|ting)?|push(?:es|ed|ing)?|deploy(?:s|ed|ing)?|generate(?:s|d|ing)?|scaffold(?:s|ed|ing)?|author(?:s|ed|ing)?|change(?:s|d|ing)?)'
const MUTATING_DELEGATION_MARKER = new RegExp(
  [
    `\\b(?:and|then|also)\\s+${MUTATING_ACTION}\\b`,
    `\\b(?:please|must|should|need(?:s)?\\s+to|you(?:'ll|\\s+will|\\s+must|\\s+should))\\s+${MUTATING_ACTION}\\b`,
    `(?:^|[\\n.;:!?]\\s*|[-*]\\s+)${MUTATING_ACTION}\\b`,
  ].join('|'),
  'i',
)

type DelegationInput = Record<string, unknown>
type ReadOnlyAgentDefinition = {
  agentType: string
  source: string
  permissionMode?: string
}

/**
 * Security boundary for task-free research delegation. Agent names alone are
 * insufficient because project/user definitions can override built-ins.
 * Keep this module dependency-free: it is imported by the tool executor while
 * AgentTool itself is still being initialized.
 */
export function isShippedReadOnlyAgentDefinition(agent: {
  agentType: string
  source: string
  permissionMode?: string
}): boolean {
  return (
    SHIPPED_READ_ONLY_AGENT_TYPES.has(agent.agentType) &&
    agent.source === 'built-in' &&
    agent.permissionMode === 'plan'
  )
}

/**
 * Some models select `general-purpose` for a research-only brief. Some repeat
 * the caller's "read-only" wording and others preserve only the research/report
 * instructions. Honor either narrower contract by downgrading the call to the
 * shipped Explore agent before task gating and permission hooks. This can only
 * remove capabilities; it never grants a custom or write-capable worker
 * task-free access.
 *
 * Named/team/worktree/cwd/nested delegation stays outside this compatibility
 * path. Returning the original object by identity makes non-matches explicit.
 */
export function normalizeReadOnlyResearchDelegation(
  input: DelegationInput,
  activeAgents: readonly ReadOnlyAgentDefinition[],
  isNestedAgent: boolean,
): DelegationInput {
  if (
    isNestedAgent ||
    input.subagent_type !== 'general-purpose' ||
    input.name !== undefined ||
    input.team_name !== undefined ||
    input.isolation !== undefined ||
    input.cwd !== undefined ||
    typeof input.prompt !== 'string' ||
    !RESEARCH_INTENT_MARKER.test(input.prompt) ||
    (!READ_ONLY_RESEARCH_MARKER.test(input.prompt) &&
      MUTATING_DELEGATION_MARKER.test(input.prompt))
  ) {
    return input
  }

  const exploreAgent = activeAgents.find(
    agent =>
      agent.agentType === 'Explore' &&
      isShippedReadOnlyAgentDefinition(agent),
  )
  if (!exploreAgent) return input

  return { ...input, subagent_type: exploreAgent.agentType }
}

/**
 * Decide whether a child definition's permission mode overrides the parent.
 * Shipped read-only agents always win; ordinary definitions preserve the
 * existing parent-mode precedence behavior.
 */
export function shouldApplyAgentDefinitionPermissionMode(
  agent: {
    agentType: string
    source: string
    permissionMode?: string
  },
  parentMode: string,
  transcriptClassifierEnabled: boolean,
): boolean {
  if (!agent.permissionMode) return false
  if (isShippedReadOnlyAgentDefinition(agent)) return true
  return (
    parentMode !== 'bypassPermissions' &&
    parentMode !== 'acceptEdits' &&
    !(transcriptClassifierEnabled && parentMode === 'auto')
  )
}
