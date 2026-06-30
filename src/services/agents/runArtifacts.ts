/**
 * Research-grade run artifacts.
 *
 * Every UR session/run gets a durable artifact manifest under
 * `.ur/runs/<run-id>/manifest.json` that links to command logs, eval reports,
 * leaderboard outputs, background task summaries, PR summaries, failure memory,
 * and the final model used. This makes the agent's work reproducible and
 * auditable without leaking data into telemetry.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'

export type RunArtifact = {
  kind:
    | 'command-log'
    | 'eval-report'
    | 'eval-compare'
    | 'leaderboard'
    | 'background-task'
    | 'pr-summary'
    | 'task-memory'
    | 'model-route'
    | 'run-metrics'
  path: string
  title?: string
  at?: string
}

export type RunManifest = {
  version: 1
  runId: string
  cwd: string
  startedAt: string
  updatedAt: string
  artifacts: RunArtifact[]
}

export function runArtifactsDir(cwd: string, runId: string): string {
  return join(cwd, '.ur', 'runs', runId)
}

export function runManifestPath(cwd: string, runId: string): string {
  return join(runArtifactsDir(cwd, runId), 'manifest.json')
}

function now(): string {
  return new Date().toISOString()
}

export function readRunManifest(cwd: string, runId: string): RunManifest | null {
  const path = runManifestPath(cwd, runId)
  if (!existsSync(path)) return null
  try {
    const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as RunManifest).version === 1 &&
      Array.isArray((parsed as RunManifest).artifacts)
    ) {
      return parsed as RunManifest
    }
  } catch {
    // ignore
  }
  return null
}

export function writeRunManifest(
  cwd: string,
  runId: string,
  manifest: Omit<RunManifest, 'cwd' | 'runId' | 'version'>,
): RunManifest {
  const dir = runArtifactsDir(cwd, runId)
  mkdirSync(dir, { recursive: true })
  const full: RunManifest = {
    version: 1,
    runId,
    cwd,
    startedAt: manifest.startedAt ?? now(),
    updatedAt: manifest.updatedAt ?? now(),
    artifacts: manifest.artifacts,
  }
  writeFileSync(runManifestPath(cwd, runId), `${JSON.stringify(full, null, 2)}\n`)
  return full
}

export function upsertRunManifest(
  cwd: string,
  runId: string,
  update: (manifest: RunManifest) => RunManifest,
): RunManifest {
  const existing = readRunManifest(cwd, runId)
  const base: RunManifest = existing ?? {
    version: 1,
    runId,
    cwd,
    startedAt: now(),
    updatedAt: now(),
    artifacts: [],
  }
  const updated = update(base)
  updated.updatedAt = now()
  return writeRunManifest(cwd, runId, updated)
}

export function addRunArtifact(
  cwd: string,
  runId: string,
  artifact: Omit<RunArtifact, 'at'>,
): RunManifest {
  return upsertRunManifest(cwd, runId, manifest => {
    const next = manifest.artifacts.filter(a => a.path !== artifact.path)
    next.push({ ...artifact, at: now() })
    return { ...manifest, artifacts: next }
  })
}

export function listRunIds(cwd: string): string[] {
  const runsDir = join(cwd, '.ur', 'runs')
  if (!existsSync(runsDir)) return []
  return readdirSync(runsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

export function loadRunManifests(cwd: string): RunManifest[] {
  return listRunIds(cwd)
    .map(id => readRunManifest(cwd, id))
    .filter((m): m is RunManifest => m !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function resolveArtifactPath(cwd: string, runId: string, relativePath: string): string {
  const absolute = join(runArtifactsDir(cwd, runId), relativePath)
  // Only allow paths inside the run artifact directory.
  const base = runArtifactsDir(cwd, runId)
  if (!absolute.startsWith(base)) {
    throw new Error(`Artifact path escapes run directory: ${relativePath}`)
  }
  return absolute
}
