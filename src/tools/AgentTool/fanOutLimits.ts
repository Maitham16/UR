/**
 * Fan-out governor for subagents.
 *
 * Agents can spawn agents, and `/crew`, `/arena`, `/bg fanout` and `/pattern`
 * all spawn several at once. Without a bound, one prompt can expand into an
 * unbounded tree: each level multiplies, every leaf costs tokens and a process,
 * and the failure mode is a wedged machine plus a large bill rather than a
 * clean error. Two independent limits close that off — how deep the tree may
 * go, and how many agents may be alive at once.
 *
 * The registry is process-local module state because the tree only exists
 * within one CLI process; detached background agents are separate processes
 * with their own budget.
 */

export const DEFAULT_MAX_AGENT_DEPTH = 3
export const DEFAULT_MAX_CONCURRENT_AGENTS = 20

export type AgentRegistration = {
  agentId: string
  /** Parent agent id, or the session id for a top-level agent. */
  parentId: string
  depth: number
  startedAt: number
}

export type FanOutLimits = {
  maxDepth: number
  maxConcurrent: number
}

export type FanOutDecision = {
  allowed: boolean
  depth: number
  /** Present when the spawn was refused; names the limit and the setting. */
  reason?: string
}

const active = new Map<string, AgentRegistration>()

/** Depth of a prospective child of `parentId`. Root agents are depth 1. */
export function depthFor(parentId: string | undefined): number {
  if (!parentId) return 1
  const parent = active.get(parentId)
  return parent ? parent.depth + 1 : 1
}

export function activeAgentCount(): number {
  return active.size
}

export function activeAgents(): AgentRegistration[] {
  return [...active.values()]
}

/**
 * Decide whether a new agent may start. Checked before any work begins so a
 * refusal costs nothing, and reported with the numbers so the caller can tell
 * the user which limit bit and how to raise it.
 */
export function canSpawnAgent(
  parentId: string | undefined,
  limits: FanOutLimits,
): FanOutDecision {
  const depth = depthFor(parentId)
  if (depth > limits.maxDepth) {
    return {
      allowed: false,
      depth,
      reason:
        `Subagent nesting limit reached (depth ${depth} > ${limits.maxDepth}). ` +
        'Raise agents.maxDepth in settings if this task genuinely needs deeper delegation.',
    }
  }
  if (active.size >= limits.maxConcurrent) {
    return {
      allowed: false,
      depth,
      reason:
        `Concurrent subagent limit reached (${active.size}/${limits.maxConcurrent} running). ` +
        'Wait for running agents to finish, or raise agents.maxConcurrent in settings.',
    }
  }
  return { allowed: true, depth }
}

/**
 * Record a started agent. Returns a release function; callers must invoke it in
 * a `finally` so a crashed or cancelled agent cannot leak a slot and wedge the
 * limit permanently.
 */
export function registerAgent(
  agentId: string,
  parentId: string | undefined,
  depth: number,
  now: () => number = Date.now,
): () => void {
  active.set(agentId, {
    agentId,
    parentId: parentId ?? 'session',
    depth,
    startedAt: now(),
  })
  let released = false
  return () => {
    // Idempotent: double-release must not corrupt the count.
    if (released) return
    released = true
    active.delete(agentId)
  }
}

/** Test hook. Never call from production paths. */
export function resetFanOutRegistryForTesting(): void {
  active.clear()
}
