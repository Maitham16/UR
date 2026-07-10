import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'
import { type ArenaResult, runArena } from './arena.js'
import { recordOutcome } from './learning.js'

/**
 * Detached best-of-N task platform (the local-first answer to
 * `codex cloud exec --attempts N` / Cursor cloud agents): `run` registers a
 * task and spawns a detached worker that races N isolated worktree agents
 * via the arena judge; results persist under .ur/cloud so you can browse
 * finished tasks later and `apply` the winning diff whenever you're ready.
 * The `runner` field is recorded for future remote runner targets; today all
 * execution is local-detached.
 */

export type CloudTask = {
  id: string
  task: string
  attempts: number
  status: 'queued' | 'running' | 'done' | 'failed'
  runner: 'local'
  model?: string
  maxTurns?: number
  createdAt: string
  updatedAt: string
  workerPid?: number
  /** Set when done: winner id + whether a non-empty diff exists. */
  winner?: { id: string; verdict: string | null; hasDiff: boolean } | null
}

type Manifest = { version: 1; tasks: CloudTask[] }

function cloudDir(cwd: string): string {
  return join(cwd, '.ur', 'cloud')
}
function manifestPath(cwd: string): string {
  return join(cloudDir(cwd), 'manifest.json')
}
function resultPath(cwd: string, id: string): string {
  return join(cloudDir(cwd), `${id}-result.json`)
}
function logPath(cwd: string, id: string): string {
  return join(cloudDir(cwd), `${id}.log`)
}

function loadManifest(cwd: string): Manifest {
  const parsed = existsSync(manifestPath(cwd))
    ? safeParseJSON(readFileSync(manifestPath(cwd), 'utf-8'), false)
    : null
  return parsed && typeof parsed === 'object'
    ? (parsed as Manifest)
    : { version: 1, tasks: [] }
}

function saveManifest(cwd: string, manifest: Manifest): void {
  mkdirSync(cloudDir(cwd), { recursive: true })
  writeFileSync(manifestPath(cwd), `${JSON.stringify(manifest, null, 2)}\n`)
}

function updateTask(cwd: string, id: string, patch: Partial<CloudTask>): void {
  const manifest = loadManifest(cwd)
  const task = manifest.tasks.find(t => t.id === id)
  if (!task) return
  Object.assign(task, patch, { updatedAt: new Date().toISOString() })
  saveManifest(cwd, manifest)
}

export function listCloudTasks(cwd: string): CloudTask[] {
  return loadManifest(cwd).tasks
}

export function getCloudTask(cwd: string, id: string): CloudTask | null {
  return loadManifest(cwd).tasks.find(t => t.id === id) ?? null
}

export function loadCloudResult(cwd: string, id: string): ArenaResult | null {
  const path = resultPath(cwd, id)
  if (!existsSync(path)) return null
  return safeParseJSON(readFileSync(path, 'utf-8'), false) as ArenaResult | null
}

export function createCloudTask(
  cwd: string,
  input: { task: string; attempts: number; model?: string; maxTurns?: number },
): CloudTask {
  const now = new Date().toISOString()
  const task: CloudTask = {
    id: `cl-${Date.now().toString(36)}`,
    task: input.task,
    attempts: Math.min(8, Math.max(1, input.attempts)),
    status: 'queued',
    runner: 'local',
    model: input.model,
    maxTurns: input.maxTurns,
    createdAt: now,
    updatedAt: now,
  }
  const manifest = loadManifest(cwd)
  manifest.tasks.push(task)
  saveManifest(cwd, manifest)
  return task
}

/** Spawn the detached worker process for a queued task. */
export function spawnCloudWorker(
  cwd: string,
  id: string,
  bin?: { file: string; baseArgs: string[] },
): number | null {
  const file = bin?.file ?? process.execPath
  const baseArgs = bin?.baseArgs ?? [process.argv[1] ?? '']
  mkdirSync(cloudDir(cwd), { recursive: true })
  const log = openSync(logPath(cwd, id), 'a')
  const child = spawn(file, [...baseArgs, 'cloud', 'worker', id], {
    cwd,
    detached: true,
    stdio: ['ignore', log, log],
  })
  child.unref()
  updateTask(cwd, id, { status: 'running', workerPid: child.pid })
  return child.pid ?? null
}

/** Executed inside the detached worker process (`ur cloud worker <id>`). */
export async function runCloudWorker(cwd: string, id: string): Promise<void> {
  const task = getCloudTask(cwd, id)
  if (!task) throw new Error(`cloud task not found: ${id}`)
  updateTask(cwd, id, { status: 'running' })
  try {
    const result = await runArena(task.task, {
      cwd,
      agents: task.attempts,
      maxTurns: task.maxTurns,
      // Keep diffs in the result; worktrees are cleaned, patches persist.
      models: task.model ? Array.from({ length: task.attempts }, () => task.model!) : undefined,
    })
    writeFileSync(resultPath(cwd, id), `${JSON.stringify(result, null, 2)}\n`)
    updateTask(cwd, id, {
      status: 'done',
      winner: result.winner
        ? {
            id: result.winner.id,
            verdict: result.winner.verdict,
            hasDiff: !!result.winner.diff?.trim(),
          }
        : null,
    })
    recordOutcome(cwd, {
      id: `cloud-${id}`,
      task: task.task,
      model: task.model ?? null,
      pass: !!result.winner && result.winner.verdict === 'PASS',
      detail: `cloud best-of-${task.attempts}`,
    })
  } catch (error) {
    updateTask(cwd, id, { status: 'failed' })
    writeFileSync(
      resultPath(cwd, id),
      `${JSON.stringify({ error: String(error) }, null, 2)}\n`,
    )
    throw error
  }
}

export function formatCloudTasks(tasks: CloudTask[], json: boolean): string {
  if (json) return JSON.stringify({ tasks }, null, 2)
  if (!tasks.length) return 'No cloud tasks. Start one: ur cloud run "<task>" --attempts 3'
  return tasks
    .map(
      t =>
        `${t.id}  ${t.status.padEnd(8)} best-of-${t.attempts}  ${t.winner ? `winner=${t.winner.id}(${t.winner.verdict ?? '?'})` : ''}  ${t.task.slice(0, 60)}`,
    )
    .join('\n')
}
