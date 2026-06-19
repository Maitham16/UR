/**
 * Headless agent crew.
 *
 * The non-interactive, scriptable counterpart to UR's in-session swarm/teammate
 * system. A crew is a shared task board (`.ur/crew/<name>.json`): a lead
 * decomposes a goal into subtasks, then one or more workers atomically *claim*
 * the next open task and run it as a headless `ur -p` subagent — optionally each
 * in its own git worktree so their edits don't collide. State is plain JSON so a
 * run can be inspected, resumed, or committed. This is UR's local-first take on
 * the 2026 "agent teams / lead+worker over a shared task file with worktrees"
 * pattern. Decomposition and claiming are deterministic and unit-testable; the
 * actual model spawning lives behind the injected step runner (see cliStepRunner).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'
import { makeCliStepRunner, makeDryRunner } from './cliStepRunner.js'
import type { StepRunner, Verdict } from './executor.js'
import type { WorkflowStep } from './workflows.js'

export type CrewTaskStatus = 'todo' | 'claimed' | 'done' | 'failed'

export type CrewTask = {
  id: string
  title: string
  prompt: string
  status: CrewTaskStatus
  assignee?: string
  worktree?: string
  result?: string
  verdict?: Verdict | null
  claimedAt?: string
  finishedAt?: string
}

export type CrewSpec = {
  version: 1
  name: string
  goal: string
  lead: string
  createdAt: string
  updatedAt: string
  tasks: CrewTask[]
}

export function crewDir(cwd: string): string {
  return join(cwd, '.ur', 'crew')
}

export function sanitizeCrewName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function crewPath(cwd: string, name: string): string {
  return join(crewDir(cwd), `${sanitizeCrewName(name)}.json`)
}

function isCrewSpec(value: unknown): value is CrewSpec {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as CrewSpec).tasks) &&
    typeof (value as CrewSpec).goal === 'string'
  )
}

export function listCrews(cwd: string): CrewSpec[] {
  const dir = crewDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => safeParseJSON(readFileSync(join(dir, file), 'utf-8'), false))
    .filter(isCrewSpec)
}

export function loadCrew(cwd: string, name: string): CrewSpec | null {
  const path = crewPath(cwd, name)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return isCrewSpec(parsed) ? parsed : null
}

export function saveCrew(cwd: string, spec: CrewSpec): void {
  mkdirSync(crewDir(cwd), { recursive: true })
  writeFileSync(crewPath(cwd, spec.name), `${JSON.stringify(spec, null, 2)}\n`)
}

export function deleteCrew(cwd: string, name: string): boolean {
  const path = crewPath(cwd, name)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}

/**
 * Decompose a free-text goal into subtasks. Deterministic: prefers an explicit
 * numbered list, then bullet points, then newlines, then sentence-level
 * conjunctions ("and"/"then"). Falls back to a single task when no structure is
 * found, so the lead never invents work that wasn't asked for.
 */
export function decomposeGoal(goal: string): string[] {
  // The CLI arg round-trip can turn real newlines into a literal "\n"; normalize
  // so a multi-line goal pasted through a flag still decomposes correctly.
  const clean = goal.replace(/\\n/g, '\n').trim()
  if (!clean) return []

  // Numbered list, whether newline- or inline-separated ("1. a 2. b 3. c").
  const numberMatches = clean.match(/\b\d+[.)]\s+/g)
  if (numberMatches && numberMatches.length >= 2) {
    const parts = clean.split(/\s*\b\d+[.)]\s+/).map(part => part.trim()).filter(Boolean)
    if (parts.length >= 2) return parts
  }

  // Bullet list.
  const bulletMatches = clean.match(/(?:^|\n)\s*[-*]\s+/g)
  if (bulletMatches && bulletMatches.length >= 2) {
    const parts = clean.split(/(?:^|\n)\s*[-*]\s+/).map(part => part.trim()).filter(Boolean)
    if (parts.length >= 2) return parts
  }

  // Distinct lines.
  const lines = clean.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length >= 2) return lines

  // Sentence-level conjunctions ("write the parser and then add tests").
  const byConjunction = clean
    .split(/\s*(?:,?\s+(?:and then|then|and)\s+)\s*/i)
    .map(part => part.trim())
    .filter(Boolean)
  if (byConjunction.length >= 2 && byConjunction.length <= 6) return byConjunction

  return [clean]
}

function makeTask(index: number, instruction: string, goal: string): CrewTask {
  const title = instruction.length > 72 ? `${instruction.slice(0, 69)}...` : instruction
  return {
    id: `t${index + 1}`,
    title,
    prompt: `Overall goal: ${goal}\n\nYour subtask: ${instruction}\n\nComplete only this subtask. End your reply with VERDICT: PASS if you finished it, or VERDICT: FAIL if you could not.`,
    status: 'todo',
  }
}

export function createCrew(
  cwd: string,
  name: string,
  goal: string,
  options: { lead?: string; tasks?: string[] } = {},
): CrewSpec {
  const now = new Date().toISOString()
  const instructions = options.tasks && options.tasks.length > 0 ? options.tasks : decomposeGoal(goal)
  const spec: CrewSpec = {
    version: 1,
    name: sanitizeCrewName(name),
    goal: goal.trim(),
    lead: options.lead ?? 'general-purpose',
    createdAt: now,
    updatedAt: now,
    tasks: instructions.map((instruction, index) => makeTask(index, instruction, goal)),
  }
  saveCrew(cwd, spec)
  return spec
}

export function addCrewTask(cwd: string, name: string, instruction: string): CrewSpec | null {
  const spec = loadCrew(cwd, name)
  if (!spec) return null
  const task = makeTask(spec.tasks.length, instruction, spec.goal)
  const updated: CrewSpec = { ...spec, updatedAt: new Date().toISOString(), tasks: [...spec.tasks, task] }
  saveCrew(cwd, updated)
  return updated
}

/**
 * Atomically claim the next open task for a worker. Synchronous read-modify-write
 * keeps claims race-free within the single-process event loop, so concurrent
 * workers never grab the same task.
 */
export function claimNextTask(cwd: string, name: string, worker: string): CrewTask | null {
  const spec = loadCrew(cwd, name)
  if (!spec) return null
  const task = spec.tasks.find(item => item.status === 'todo')
  if (!task) return null
  task.status = 'claimed'
  task.assignee = worker
  task.claimedAt = new Date().toISOString()
  spec.updatedAt = task.claimedAt
  saveCrew(cwd, spec)
  return task
}

export function completeTask(
  cwd: string,
  name: string,
  taskId: string,
  result: { status: 'done' | 'failed'; output?: string; verdict?: Verdict | null; worktree?: string },
): CrewSpec | null {
  const spec = loadCrew(cwd, name)
  if (!spec) return null
  const task = spec.tasks.find(item => item.id === taskId)
  if (!task) return null
  task.status = result.status
  task.result = result.output?.slice(0, 2000)
  task.verdict = result.verdict ?? null
  if (result.worktree) task.worktree = result.worktree
  task.finishedAt = new Date().toISOString()
  spec.updatedAt = task.finishedAt
  saveCrew(cwd, spec)
  return spec
}

/** Reset orphaned `claimed` tasks (from a crashed run) back to `todo`. */
export function reopenClaimed(cwd: string, name: string): CrewSpec | null {
  const spec = loadCrew(cwd, name)
  if (!spec) return null
  let changed = false
  for (const task of spec.tasks) {
    if (task.status === 'claimed') {
      task.status = 'todo'
      task.assignee = undefined
      changed = true
    }
  }
  if (changed) {
    spec.updatedAt = new Date().toISOString()
    saveCrew(cwd, spec)
  }
  return spec
}

export type CrewProgress = { total: number; done: number; failed: number; todo: number; claimed: number }

export function crewProgress(spec: CrewSpec): CrewProgress {
  return {
    total: spec.tasks.length,
    done: spec.tasks.filter(t => t.status === 'done').length,
    failed: spec.tasks.filter(t => t.status === 'failed').length,
    todo: spec.tasks.filter(t => t.status === 'todo').length,
    claimed: spec.tasks.filter(t => t.status === 'claimed').length,
  }
}

function taskToStep(task: CrewTask, lead: string): WorkflowStep {
  return { id: task.id, name: task.title, agent: lead, prompt: task.prompt }
}

/** Create a git worktree for a worker; returns null (and leaves cwd) on failure. */
async function ensureWorktree(
  cwd: string,
  crew: string,
  worker: string,
): Promise<string | null> {
  const path = join(crewDir(cwd), '.worktrees', `${crew}-${worker}`)
  const branch = `ur/crew/${crew}/${worker}`
  if (existsSync(path)) return path
  mkdirSync(join(crewDir(cwd), '.worktrees'), { recursive: true })
  const result = await execFileNoThrowWithCwd(
    'git',
    ['worktree', 'add', '-b', branch, path],
    { cwd, timeout: 60_000, preserveOutputOnError: true },
  )
  return result.code === 0 ? path : null
}

export type RunCrewOptions = {
  cwd: string
  workers?: number
  dryRun?: boolean
  worktrees?: boolean
  resume?: boolean
  maxTurns?: number
  skipPermissions?: boolean
  onEvent?: (event: CrewEvent) => void
  /** Injectable runner override (tests). When set, worktrees are ignored. */
  runnerFor?: (workerCwd: string) => StepRunner
}

export type CrewEvent =
  | { kind: 'claim'; worker: string; taskId: string; title: string }
  | { kind: 'done'; worker: string; taskId: string; status: 'done' | 'failed'; verdict?: Verdict | null }
  | { kind: 'worker-exit'; worker: string; handled: number }

export type RunCrewResult = {
  name: string
  workers: number
  progress: CrewProgress
  handled: Array<{ worker: string; taskId: string; status: 'done' | 'failed' }>
}

export async function runCrew(name: string, options: RunCrewOptions): Promise<RunCrewResult> {
  const cwd = options.cwd
  const baseSpec = loadCrew(cwd, name)
  if (!baseSpec) throw new Error(`Crew not found: ${name}`)

  // Orphaned `claimed` tasks (from a crashed run) are reopened either way; the
  // distinction is that without --resume the user is restarting the same board.
  reopenClaimed(cwd, name)

  const workerCount = Math.max(1, options.workers ?? 1)
  const lead = baseSpec.lead
  const handled: RunCrewResult['handled'] = []

  const makeRunner = (workerCwd: string): StepRunner => {
    if (options.runnerFor) return options.runnerFor(workerCwd)
    return options.dryRun
      ? makeDryRunner()
      : makeCliStepRunner({
          cwd: workerCwd,
          maxTurns: options.maxTurns,
          skipPermissions: options.skipPermissions,
        })
  }

  async function worker(workerId: string): Promise<number> {
    let count = 0
    let workerCwd = cwd
    if (options.worktrees && !options.dryRun && !options.runnerFor) {
      const wt = await ensureWorktree(cwd, name, workerId)
      if (wt) workerCwd = wt
    }
    const runner = makeRunner(workerCwd)

    for (;;) {
      const task = claimNextTask(cwd, name, workerId)
      if (!task) break
      options.onEvent?.({ kind: 'claim', worker: workerId, taskId: task.id, title: task.title })
      const out = await runner({ step: taskToStep(task, lead), iteration: 1, priorOutputs: {} })
      const status: 'done' | 'failed' = out.isError || out.verdict === 'FAIL' ? 'failed' : 'done'
      completeTask(cwd, name, task.id, {
        status,
        output: out.output,
        verdict: out.verdict,
        worktree: workerCwd === cwd ? undefined : workerCwd,
      })
      handled.push({ worker: workerId, taskId: task.id, status })
      options.onEvent?.({ kind: 'done', worker: workerId, taskId: task.id, status, verdict: out.verdict })
      count += 1
    }
    options.onEvent?.({ kind: 'worker-exit', worker: workerId, handled: count })
    return count
  }

  const workerIds = Array.from({ length: workerCount }, (_, i) => `w${i + 1}`)
  await Promise.all(workerIds.map(worker))

  const finalSpec = loadCrew(cwd, name) ?? baseSpec
  return { name, workers: workerCount, progress: crewProgress(finalSpec), handled }
}

export function formatCrewList(crews: CrewSpec[], json: boolean): string {
  if (json) return JSON.stringify({ crews: crews.map(c => ({ name: c.name, goal: c.goal, ...crewProgress(c) })) }, null, 2)
  if (crews.length === 0) {
    return 'No crews yet. Create one with `ur crew create <name> --goal "..."`.'
  }
  const lines = ['Crews', '']
  for (const crew of crews) {
    const p = crewProgress(crew)
    lines.push(`${crew.name}  (${p.done}/${p.total} done${p.failed ? `, ${p.failed} failed` : ''})`)
    lines.push(`  ${crew.goal}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function formatCrew(spec: CrewSpec, json: boolean): string {
  if (json) return JSON.stringify({ ...spec, progress: crewProgress(spec) }, null, 2)
  const p = crewProgress(spec)
  const mark: Record<CrewTaskStatus, string> = { todo: '○', claimed: '◐', done: '✓', failed: '✗' }
  const lines = [
    `Crew: ${spec.name}`,
    `Goal: ${spec.goal}`,
    `Lead: ${spec.lead}`,
    `Progress: ${p.done}/${p.total} done, ${p.todo} todo, ${p.claimed} in-progress, ${p.failed} failed`,
    '',
    'Tasks:',
  ]
  for (const task of spec.tasks) {
    lines.push(`  ${mark[task.status]} ${task.id} ${task.title}${task.assignee ? `  [${task.assignee}]` : ''}${task.verdict ? `  (${task.verdict})` : ''}`)
  }
  return lines.join('\n')
}

export function formatRunCrewResult(result: RunCrewResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const p = result.progress
  const lines = [
    `Crew ${result.name} ran with ${result.workers} worker(s).`,
    `Handled ${result.handled.length} task(s); ${p.done}/${p.total} done${p.failed ? `, ${p.failed} failed` : ''}.`,
  ]
  for (const item of result.handled) {
    lines.push(`  ${item.worker} → ${item.taskId}: ${item.status}`)
  }
  return lines.join('\n')
}
