import type { PromptPlanningConfig } from './types.js'

export const DEFAULT_PROMPT_PLANNING_CONFIG: PromptPlanningConfig = {
  taskPlanning: true,
  parallelAgents: true,
  maxAgents: 3,
  showTaskBoard: true,
  strictVerification: true,
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function maxAgents(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(16, Math.floor(value)))
}

export function resolvePromptPlanningConfig(
  settings?: unknown,
  fallback: PromptPlanningConfig = DEFAULT_PROMPT_PLANNING_CONFIG,
): PromptPlanningConfig {
  const root = asRecord(settings) ?? {}
  const nested =
    asRecord(root.taskPlanningConfig) ??
    asRecord(root.promptPlanning) ??
    asRecord(root.nexus) ??
    asRecord(root.urAgent) ??
    {}

  const value = (key: keyof PromptPlanningConfig): unknown =>
    nested[key] ?? root[key]

  return {
    taskPlanning: bool(
      value('taskPlanning'),
      fallback.taskPlanning,
    ),
    parallelAgents: bool(
      value('parallelAgents'),
      fallback.parallelAgents,
    ),
    maxAgents: maxAgents(
      value('maxAgents'),
      fallback.maxAgents,
    ),
    showTaskBoard: bool(
      value('showTaskBoard'),
      fallback.showTaskBoard,
    ),
    strictVerification: bool(
      value('strictVerification'),
      fallback.strictVerification,
    ),
  }
}
