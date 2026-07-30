export const AGENT_TOOL_NAME = 'Agent'
// Legacy wire name for backward compat (permission rules, hooks, resumed sessions)
export const LEGACY_AGENT_TOOL_NAME = 'Task'
export const VERIFICATION_AGENT_TYPE = 'verification'

// These are the only Agent targets whose built-in definitions are guaranteed
// to be read-only and therefore safe to delegate to while the parent is
// gathering evidence in plan mode.
export const READ_ONLY_PLAN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
])

// Built-in agents that run once and return a report — the parent never
// SendMessages back to continue them. Skip the agentId/SendMessage/usage
// trailer for these to save tokens (~135 chars × 34M Explore runs/week).
export const ONE_SHOT_BUILTIN_AGENT_TYPES = READ_ONLY_PLAN_AGENT_TYPES
