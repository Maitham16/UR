/**
 * Persistent goals.
 *
 * A goal is a long-horizon objective that survives across sessions: it records
 * what we're trying to achieve, its status, a running log of progress notes, and
 * (optionally) the workflow or collaboration pattern that drives it. Goals are
 * plain JSON under `.ur/goals/` so they can be inspected, diffed, and committed.
 * Resuming a goal re-runs its linked workflow from the last checkpoint, which is
 * how UR matches the "Goals" / long-running objective model that the cloud agents
 * expose — but kept local-first and file-backed. Mirrors magent's planned
 * objective-tracking node.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'

export type GoalStatus = 'active' | 'paused' | 'done' | 'abandoned'

export type GoalNote = { at: string; text: string }

export type GoalSpec = {
  version: 1
  name: string
  objective: string
  status: GoalStatus
  createdAt: string
  updatedAt: string
  /** Workflow name (under .ur/workflows) that advances this goal, if any. */
  workflow?: string
  /** Collaboration pattern id (peer/doe/...) associated with this goal, if any. */
  pattern?: string
  notes: GoalNote[]
}

export function goalsDir(cwd: string): string {
  return join(cwd, '.ur', 'goals')
}

export function sanitizeGoalName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function goalPath(cwd: string, name: string): string {
  return join(goalsDir(cwd), `${sanitizeGoalName(name)}.json`)
}

export function listGoals(cwd: string): GoalSpec[] {
  const dir = goalsDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => safeParseJSON(readFileSync(join(dir, file), 'utf-8'), false))
    .filter((spec): spec is GoalSpec => isGoalSpec(spec))
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
  return isGoalSpec(parsed) ? parsed : null
}

export function saveGoal(cwd: string, spec: GoalSpec): void {
  mkdirSync(goalsDir(cwd), { recursive: true })
  writeFileSync(goalPath(cwd, spec.name), `${JSON.stringify(spec, null, 2)}\n`)
}

export function createGoal(
  cwd: string,
  name: string,
  objective: string,
  options: { workflow?: string; pattern?: string } = {},
): GoalSpec {
  const now = new Date().toISOString()
  const spec: GoalSpec = {
    version: 1,
    name: sanitizeGoalName(name),
    objective: objective.trim(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...(options.workflow ? { workflow: options.workflow } : {}),
    ...(options.pattern ? { pattern: options.pattern } : {}),
    notes: [],
  }
  saveGoal(cwd, spec)
  return spec
}

export function setGoalStatus(cwd: string, name: string, status: GoalStatus): GoalSpec | null {
  const spec = loadGoal(cwd, name)
  if (!spec) return null
  const updated: GoalSpec = { ...spec, status, updatedAt: new Date().toISOString() }
  saveGoal(cwd, updated)
  return updated
}

export function addGoalNote(cwd: string, name: string, text: string): GoalSpec | null {
  const spec = loadGoal(cwd, name)
  if (!spec) return null
  const now = new Date().toISOString()
  const updated: GoalSpec = {
    ...spec,
    updatedAt: now,
    notes: [...spec.notes, { at: now, text: text.trim() }],
  }
  saveGoal(cwd, updated)
  return updated
}

export function deleteGoal(cwd: string, name: string): boolean {
  const path = goalPath(cwd, name)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
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
  if (goal.workflow) lines.push(`Workflow: ${goal.workflow}`)
  if (goal.pattern) lines.push(`Pattern: ${goal.pattern}`)
  if (goal.notes.length) {
    lines.push('', 'Progress log:')
    for (const note of goal.notes) lines.push(`  ${note.at}  ${note.text}`)
  }
  return lines.join('\n')
}
