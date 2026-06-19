/**
 * Spec-driven development.
 *
 * Treats the spec, not the code, as the source of truth: each feature gets a
 * `.ur/specs/<name>/` folder with requirements.md -> design.md -> tasks.md and a
 * spec.json that tracks the current phase and approvals. Tasks use the same
 * `- [ ] T1: ...` checkbox format as GitHub Spec Kit / Kiro, so the list is
 * drop-in portable and a paste from those tools runs unchanged. The executor
 * walks the open tasks and drives each one through a headless agent, marking it
 * done on a PASS verdict. Markdown scaffolding and task parsing are pure and
 * offline; only `run`/`generate` touch a model (behind the injectable runner).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'
import { decomposeGoal } from './crew.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'

export type SpecPhase = 'requirements' | 'design' | 'tasks'

export type SpecMeta = {
  version: 1
  name: string
  goal: string
  phase: SpecPhase
  approvals: Record<SpecPhase, boolean>
  createdAt: string
  updatedAt: string
}

export type SpecTask = { id: string; title: string; done: boolean }

export function specsDir(cwd: string): string {
  return join(cwd, '.ur', 'specs')
}

export function slugifySpecName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'spec'
}

export function specDir(cwd: string, name: string): string {
  return join(specsDir(cwd), slugifySpecName(name))
}

function metaPath(cwd: string, name: string): string {
  return join(specDir(cwd, name), 'spec.json')
}

export function phaseFile(phase: SpecPhase): string {
  return `${phase}.md`
}

export function listSpecs(cwd: string): SpecMeta[] {
  const dir = specsDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(entry => existsSync(join(dir, entry, 'spec.json')))
    .map(entry => safeParseJSON(readFileSync(join(dir, entry, 'spec.json'), 'utf-8'), false))
    .filter((m): m is SpecMeta => !!m && typeof m === 'object' && 'goal' in (m as object))
}

export function loadSpec(cwd: string, name: string): SpecMeta | null {
  const path = metaPath(cwd, name)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object' ? (parsed as SpecMeta) : null
}

function saveMeta(cwd: string, meta: SpecMeta): void {
  mkdirSync(specDir(cwd, meta.name), { recursive: true })
  writeFileSync(metaPath(cwd, meta.name), `${JSON.stringify(meta, null, 2)}\n`)
}

export function readPhase(cwd: string, name: string, phase: SpecPhase): string | null {
  const path = join(specDir(cwd, name), phaseFile(phase))
  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

export function writePhase(cwd: string, name: string, phase: SpecPhase, body: string): void {
  mkdirSync(specDir(cwd, name), { recursive: true })
  writeFileSync(join(specDir(cwd, name), phaseFile(phase)), body.endsWith('\n') ? body : `${body}\n`)
}

function requirementsTemplate(name: string, goal: string): string {
  return [
    `# Requirements: ${name}`,
    '',
    `## Goal`,
    goal,
    '',
    `## User stories`,
    `- As a user, I want ${goal.toLowerCase()} so that the outcome is reliable.`,
    '',
    `## Acceptance criteria (EARS)`,
    `1. WHEN the feature is invoked THEN the system SHALL fulfil the goal above.`,
    `2. WHEN an input is invalid THEN the system SHALL fail safely with a clear message.`,
    '',
    `## Non-functional`,
    `- Local-first: no required network calls beyond the local model endpoint.`,
    `- Deterministic, testable core logic.`,
    '',
  ].join('\n')
}

function designTemplate(name: string, goal: string): string {
  return [
    `# Design: ${name}`,
    '',
    `## Overview`,
    `Technical approach for: ${goal}`,
    '',
    `## Components`,
    `- Entry point / command surface`,
    `- Core logic (pure, unit-tested)`,
    `- Persistence / state (if any)`,
    '',
    `## Data model`,
    `Describe the key types and state files here.`,
    '',
    `## Risks & trade-offs`,
    `List the main risks and the chosen trade-offs.`,
    '',
  ].join('\n')
}

function tasksTemplate(name: string, goal: string): string {
  const subtasks = decomposeGoal(goal)
  const lines = [`# Tasks: ${name}`, '', `Derived from the goal. Check off as each is completed.`, '']
  subtasks.forEach((task, index) => {
    lines.push(`- [ ] T${index + 1}: ${task}`)
  })
  lines.push('')
  return lines.join('\n')
}

export function createSpec(cwd: string, name: string, goal: string): SpecMeta {
  const now = new Date().toISOString()
  const meta: SpecMeta = {
    version: 1,
    name: slugifySpecName(name),
    goal: goal.trim(),
    phase: 'requirements',
    approvals: { requirements: false, design: false, tasks: false },
    createdAt: now,
    updatedAt: now,
  }
  saveMeta(cwd, meta)
  writePhase(cwd, meta.name, 'requirements', requirementsTemplate(meta.name, meta.goal))
  writePhase(cwd, meta.name, 'design', designTemplate(meta.name, meta.goal))
  writePhase(cwd, meta.name, 'tasks', tasksTemplate(meta.name, meta.goal))
  return meta
}

export function deleteSpec(cwd: string, name: string): boolean {
  const dir = specDir(cwd, name)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

export function approvePhase(cwd: string, name: string, phase: SpecPhase): SpecMeta | null {
  const meta = loadSpec(cwd, name)
  if (!meta) return null
  meta.approvals[phase] = true
  const next: Record<SpecPhase, SpecPhase> = {
    requirements: 'design',
    design: 'tasks',
    tasks: 'tasks',
  }
  meta.phase = next[phase]
  meta.updatedAt = new Date().toISOString()
  saveMeta(cwd, meta)
  return meta
}

const TASK_RE = /^\s*-\s*\[( |x|X)\]\s*(?:(T\d+)\s*:?\s*)?(.*)$/

export function parseTasks(markdown: string): SpecTask[] {
  const tasks: SpecTask[] = []
  let auto = 0
  for (const line of markdown.split('\n')) {
    const match = TASK_RE.exec(line)
    if (!match) continue
    auto++
    tasks.push({
      id: match[2] ?? `T${auto}`,
      title: match[3].trim(),
      done: match[1].toLowerCase() === 'x',
    })
  }
  return tasks
}

export function markTaskDone(markdown: string, id: string): string {
  return markdown
    .split('\n')
    .map(line => {
      const match = TASK_RE.exec(line)
      if (!match) return line
      const taskId = match[2] ?? null
      if (taskId === id) return line.replace(/\[( )\]/, '[x]')
      return line
    })
    .join('\n')
}

export type SpecRunOptions = {
  cwd: string
  all?: boolean
  dryRun?: boolean
  maxTurns?: number
  skipPermissions?: boolean
  runner?: HeadlessRunner
  onEvent?: (event: { id: string; title: string; verdict: string | null; isError: boolean }) => void
}

export type SpecRunResult = {
  name: string
  ran: Array<{ id: string; title: string; status: 'done' | 'failed' }>
  remaining: number
  stoppedOnFailure: boolean
}

export async function runSpec(
  cwd: string,
  name: string,
  options: SpecRunOptions,
): Promise<SpecRunResult> {
  const meta = loadSpec(cwd, name)
  if (!meta) throw new Error(`Spec not found: ${name}`)
  const runner =
    options.runner ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())

  const requirements = readPhase(cwd, name, 'requirements') ?? ''
  const design = readPhase(cwd, name, 'design') ?? ''
  const context = `Requirements:\n${requirements}\n\nDesign:\n${design}`.slice(0, 6000)

  const ran: SpecRunResult['ran'] = []
  let stoppedOnFailure = false

  for (;;) {
    const tasksMd = readPhase(cwd, name, 'tasks') ?? ''
    const tasks = parseTasks(tasksMd)
    const next = tasks.find(t => !t.done)
    if (!next) break

    const out = await runner({
      cwd,
      prompt: `You are implementing one task of a specced feature.\n\n${context}\n\nYour task ${next.id}: ${next.title}\n\nImplement only this task, consistent with the requirements and design. End your reply with VERDICT: PASS if complete, or VERDICT: FAIL.`,
      maxTurns: options.maxTurns,
      skipPermissions: options.skipPermissions,
    })
    const ok = !out.isError && out.verdict !== 'FAIL'
    options.onEvent?.({ id: next.id, title: next.title, verdict: out.verdict ?? null, isError: !!out.isError })
    ran.push({ id: next.id, title: next.title, status: ok ? 'done' : 'failed' })

    if (ok && !options.dryRun) {
      writePhase(cwd, name, 'tasks', markTaskDone(tasksMd, next.id))
    } else if (ok && options.dryRun) {
      // In dry-run we don't mutate files; break to avoid looping forever.
      break
    } else {
      stoppedOnFailure = true
      break
    }
    if (!options.all) break
  }

  const remaining = parseTasks(readPhase(cwd, name, 'tasks') ?? '').filter(t => !t.done).length
  return { name: slugifySpecName(name), ran, remaining, stoppedOnFailure }
}

/** Fill a phase document by asking a model to expand it from current context. */
export async function generatePhase(
  cwd: string,
  name: string,
  phase: SpecPhase,
  options: { dryRun?: boolean; runner?: HeadlessRunner; maxTurns?: number },
): Promise<string> {
  const meta = loadSpec(cwd, name)
  if (!meta) throw new Error(`Spec not found: ${name}`)
  const runner =
    options.runner ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
  const priorReq = readPhase(cwd, name, 'requirements') ?? ''
  const priorDesign = phase === 'tasks' ? (readPhase(cwd, name, 'design') ?? '') : ''
  const instruction =
    phase === 'requirements'
      ? `Write a precise requirements.md (goal, user stories, EARS acceptance criteria, non-functional) for: ${meta.goal}`
      : phase === 'design'
        ? `Write a design.md (overview, components, data model, risks) implementing these requirements:\n${priorReq}`
        : `Write tasks.md as a checkbox list "- [ ] T1: ..." of atomic, ordered implementation tasks for:\n${priorReq}\n${priorDesign}`

  const out = await runner({
    cwd,
    prompt: `${instruction}\n\nReturn only the markdown document body.`,
    maxTurns: options.maxTurns,
  })
  if (!options.dryRun && out.output.trim()) {
    writePhase(cwd, name, phase, out.output.trim())
  }
  return out.output
}

export function formatSpecList(specs: SpecMeta[], json: boolean): string {
  if (json) return JSON.stringify({ specs }, null, 2)
  if (specs.length === 0) return 'No specs yet. Create one with `ur spec init <name> --goal "..."`.'
  const lines = ['Specs', '']
  for (const spec of specs) {
    lines.push(`${spec.name}  [phase: ${spec.phase}]`)
    lines.push(`  ${spec.goal}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function formatSpecStatus(cwd: string, meta: SpecMeta, json: boolean): string {
  const tasks = parseTasks(readPhase(cwd, meta.name, 'tasks') ?? '')
  const done = tasks.filter(t => t.done).length
  if (json) {
    return JSON.stringify({ ...meta, tasks: { total: tasks.length, done } }, null, 2)
  }
  const mark = (ok: boolean) => (ok ? '✓' : '○')
  const lines = [
    `Spec: ${meta.name}`,
    `Goal: ${meta.goal}`,
    `Phase: ${meta.phase}`,
    `Approvals: ${mark(meta.approvals.requirements)} requirements  ${mark(meta.approvals.design)} design  ${mark(meta.approvals.tasks)} tasks`,
    `Tasks: ${done}/${tasks.length} done`,
    '',
  ]
  for (const task of tasks) {
    lines.push(`  ${task.done ? '✓' : '○'} ${task.id} ${task.title}`)
  }
  return lines.join('\n')
}
