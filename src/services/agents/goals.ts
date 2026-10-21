/**
 * Persistent goals.
 *
 * A goal is a long-horizon objective that survives across sessions: it records
 * its criteria, progress, blockers, optional aggregate budgets, and evidence.
 * The model-directed controller can work directly, select a linked workflow,
 * replan, or request independent criterion verification. Workflow completion
 * alone never verifies the outcome. JSON state under `.ur/goals/` preserves
 * ownership and usage across interruptions; unknown effects require model
 * reconciliation rather than automatic replay.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { safeParseJSON } from '../../utils/json.js'
import { atomicWriteJson, ownerMayBeAlive, withStateLock, type ProcessOwner } from './durableState.js'

export type GoalStatus = 'active' | 'paused' | 'done' | 'abandoned'
export type GoalNote = { at: string; text: string }
export type GoalBudget = { maxCalls?: number; maxTurns?: number; maxCostUsd?: number; maxDurationMs?: number }
export type GoalUsage = { calls: number; turns: number; costUsd: number; elapsedMs: number; unknownCostCalls: number; unknownTurnCalls: number }
export type GoalCriterion = { id: string; text: string }
export type GoalInFlight = {
  kind: 'agent' | 'verification' | 'workflow'
  sessionId?: string
  startedAt: string
  accounted?: boolean
  pid?: number
  stepId?: string
  requiresProcessIdentity?: boolean
  workflow?: string
  stateName?: string
  prompt?: string
}
export type GoalController = {
  state: 'idle' | 'running' | 'blocked' | 'budget-exhausted' | 'interrupted' | 'completed'
  owner?: ProcessOwner
  digest?: string
  budget: GoalBudget
  usage: GoalUsage
  inFlight?: GoalInFlight
  nextPrompt?: string
  lastProgressDigest?: string
  noProgressRepeats?: number
  blockers: string[]
  history: Array<{ at: string; kind: string; summary: string; sessionId?: string; costUsd?: number; turns?: number }>
}
export type GoalOutcome = {
  status: 'unverified' | 'verified' | 'manual'
  at: string
  summary: string
  stateSha256?: string
  criteria?: Array<{ id: string; passed: boolean; reason: string; executionIds: string[]; artifacts: Array<{ path: string; sha256: string; excerpt: string }> }>
}
export type GoalSpec = {
  version: 1 | 2
  name: string
  objective: string
  status: GoalStatus
  createdAt: string
  updatedAt: string
  workflow?: string
  pattern?: string
  notes: GoalNote[]
  criteria?: GoalCriterion[]
  controller?: GoalController
  outcome?: GoalOutcome
}

export function newGoalController(budget: GoalBudget = {}): GoalController {
  return { state: 'idle', budget: { ...budget },
    usage: { calls: 0, turns: 0, costUsd: 0, elapsedMs: 0, unknownCostCalls: 0, unknownTurnCalls: 0 },
    blockers: [], history: [] }
}

export function validateGoalBudget(budget: GoalBudget): void {
  for (const [key, value] of Object.entries(budget)) {
    if (value === undefined) continue
    if (!Number.isFinite(value) || value <= 0 || (key !== 'maxCostUsd' && !Number.isSafeInteger(value))) throw new Error(`${key} must be a positive ${key === 'maxCostUsd' ? 'number' : 'integer'}.`)
  }
}

export function goalsDir(cwd: string): string {
  return join(cwd, '.ur', 'goals')
}

export function sanitizeGoalName(name: string): string {
  const normalized = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-')
  if (!normalized) throw new Error('Goal name must not be empty.')
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 69)}-${createHash('sha256').update(normalized).digest('hex').slice(0, 10)}`
}

export function goalPath(cwd: string, name: string): string {
  return join(goalsDir(cwd), `${sanitizeGoalName(name)}.json`)
}

export function listGoals(cwd: string): GoalSpec[] {
  const dir = goalsDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => loadGoal(cwd, file.slice(0, -5)))
    .filter((spec): spec is GoalSpec => spec !== null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

function isGoalSpec(value: unknown): value is GoalSpec {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as GoalSpec).name === 'string' &&
    typeof (value as GoalSpec).objective === 'string'
  )
}

export function loadGoal(cwd: string, name: string): GoalSpec | null {
  const path = goalPath(cwd, name)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  if (!isGoalSpec(parsed) || ![1, 2].includes(parsed.version) || !['active', 'paused', 'done', 'abandoned'].includes(parsed.status)) throw new Error(`Invalid goal state: ${path}`)
  if (parsed.criteria && (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0 || parsed.criteria.some(item => !item || typeof item.id !== 'string' || typeof item.text !== 'string' || !item.text.trim()) || new Set(parsed.criteria.map(item => item.id)).size !== parsed.criteria.length)) throw new Error(`Invalid goal criteria: ${path}`)
  if (parsed.controller) {
    const controller = parsed.controller
    if (!controller.budget || !controller.usage || !Array.isArray(controller.history) || !Array.isArray(controller.blockers) ||
      ['calls', 'turns', 'costUsd', 'elapsedMs', 'unknownCostCalls', 'unknownTurnCalls'].some(key => {
        const value = controller.usage[key as keyof GoalUsage]
        return typeof value !== 'number' || !Number.isFinite(value) || value < 0
      })) throw new Error(`Invalid goal accounting state: ${path}`)
    validateGoalBudget(controller.budget)
  }
  // Preserve historical user status; old workflow completion is never relabeled verified.
  return { ...parsed, version: 2, notes: parsed.notes ?? [],
    criteria: parsed.criteria ?? [{ id: 'c1', text: parsed.objective }],
    controller: parsed.controller ?? newGoalController(),
    outcome: parsed.outcome ?? { status: parsed.status === 'done' ? 'manual' : 'unverified', at: parsed.updatedAt, summary: 'Legacy goal; no execution-bound outcome verification was recorded.' } }
}

export function mutateGoal<T>(cwd: string, name: string, operation: (goal: GoalSpec) => T): T | null {
  return withStateLock(`${goalPath(cwd, name)}.mutation-lock`, () => {
    const goal = loadGoal(cwd, name)
    if (!goal) return null
    const result = operation(goal)
    goal.updatedAt = new Date().toISOString()
    atomicWriteJson(goalPath(cwd, name), goal)
    return result
  })
}

export function saveGoal(cwd: string, spec: GoalSpec): void {
  withStateLock(`${goalPath(cwd, spec.name)}.mutation-lock`, () => {
    if (ownerMayBeAlive(loadGoal(cwd, spec.name)?.controller?.owner)) throw new Error('Cannot replace a goal with a live controller.')
    atomicWriteJson(goalPath(cwd, spec.name), spec)
  })
}

export function createGoal(cwd: string, name: string, objective: string,
  options: { workflow?: string; pattern?: string; criteria?: string[]; budget?: GoalBudget } = {},
): GoalSpec {
  if (!objective.trim()) throw new Error('Goal objective must not be empty.')
  validateGoalBudget(options.budget ?? {})
  const now = new Date().toISOString()
  const criteria = options.criteria?.map(text => text.trim()).filter(Boolean)
  const spec: GoalSpec = {
    version: 2, name: sanitizeGoalName(name), objective: objective.trim(), status: 'active',
    createdAt: now, updatedAt: now, workflow: options.workflow, pattern: options.pattern, notes: [],
    criteria: (criteria?.length ? criteria : [objective.trim()]).map((text, index) => ({ id: `c${index + 1}`, text })),
    controller: newGoalController(options.budget),
    outcome: { status: 'unverified', at: now, summary: 'Objective has not been verified.' },
  }
  saveGoal(cwd, spec)
  return spec
}

export function setGoalStatus(cwd: string, name: string, status: GoalStatus): GoalSpec | null {
  return mutateGoal(cwd, name, spec => {
    spec.status = status
    if (status === 'done') spec.outcome = { status: 'manual', at: new Date().toISOString(), summary: 'Marked done explicitly by the user; no automatic verification is claimed.' }
    return spec
  })
}

export function addGoalNote(cwd: string, name: string, text: string): GoalSpec | null {
  return mutateGoal(cwd, name, spec => {
    spec.notes.push({ at: new Date().toISOString(), text: text.trim() })
    return spec
  })
}

export function deleteGoal(cwd: string, name: string): boolean {
  return withStateLock(`${goalPath(cwd, name)}.mutation-lock`, () => {
    if (!existsSync(goalPath(cwd, name))) return false
    if (ownerMayBeAlive(loadGoal(cwd, name)?.controller?.owner)) throw new Error('Cannot delete a goal with a live controller.')
    unlinkSync(goalPath(cwd, name)); return true
  })
}

const STATUS_MARK: Record<GoalStatus, string> = {
  active: '●',
  paused: '◌',
  done: '✓',
  abandoned: '✗',
}

export function formatGoalList(goals: GoalSpec[], json: boolean): string {
  if (json) return JSON.stringify({ goals }, null, 2)
  if (goals.length === 0) {
    return 'No goals yet. Create one with `ur goal add <name> --objective "..."`.'
  }
  const lines = ['Goals', '']
  for (const goal of goals) {
    lines.push(`${STATUS_MARK[goal.status]} ${goal.name} [${goal.status}]`)
    lines.push(`  ${goal.objective}`)
    if (goal.controller) lines.push(`  Controller: ${goal.controller.state}; calls ${goal.controller.usage.calls}/${goal.controller.budget.maxCalls ?? 'unlimited'}`)
    if (goal.outcome) lines.push(`  Outcome: ${goal.outcome.status}`)
    if (goal.workflow) lines.push(`  Workflow: ${goal.workflow}`)
    if (goal.notes.length) lines.push(`  Progress notes: ${goal.notes.length} (latest: ${goal.notes[goal.notes.length - 1].text})`)
    lines.push('')
  }
  return lines.join('\n')
}

export function formatGoal(goal: GoalSpec, json: boolean): string {
  if (json) return JSON.stringify(goal, null, 2)
  const lines = [
    `Goal: ${goal.name}`,
    `Status: ${goal.status}`,
    `Objective: ${goal.objective}`,
    `Created: ${goal.createdAt}`,
    `Updated: ${goal.updatedAt}`,
  ]
  if (goal.criteria?.length) lines.push('Criteria:', ...goal.criteria.map(criterion => `  ${criterion.id}: ${criterion.text}`))
  if (goal.controller) {
    lines.push(`Controller: ${goal.controller.state}`, `Budget: ${JSON.stringify(goal.controller.budget)}`, `Usage: ${JSON.stringify(goal.controller.usage)}`)
    if (goal.controller.blockers.length) lines.push('Blockers:', ...goal.controller.blockers.map(blocker => `  - ${blocker}`))
  }
  if (goal.outcome) lines.push(`Outcome: ${goal.outcome.status} (${goal.outcome.summary})`)
  if (goal.workflow) lines.push(`Workflow: ${goal.workflow}`)
  if (goal.pattern) lines.push(`Pattern: ${goal.pattern}`)
  if (goal.notes.length) {
    lines.push('', 'Progress log:')
    for (const note of goal.notes) lines.push(`  ${note.at}  ${note.text}`)
  }
  return lines.join('\n')
}
