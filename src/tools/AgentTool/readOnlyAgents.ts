const SHIPPED_READ_ONLY_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
])

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
