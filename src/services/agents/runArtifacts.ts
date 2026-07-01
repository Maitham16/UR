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
import { dirname, join, resolve } from 'node:path'
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
    | 'ci-cannot-fix'
    | 'plan'
    | 'actions'
    | 'diff'
    | 'tests-log'
    | 'report'
  path: string
  title?: string
  at?: string
}

export type RunTraceAction = {
  at: string
  kind: string
  title?: string
  status?: 'planned' | 'running' | 'passed' | 'failed' | 'blocked' | 'skipped'
  command?: string
  exitCode?: number
  stdout?: string
  stderr?: string
  reason?: string
  nextAction?: string
  data?: Record<string, unknown>
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

export function runPlanPath(cwd: string, runId: string): string {
  return join(runArtifactsDir(cwd, runId), 'plan.json')
}

export function runActionsPath(cwd: string, runId: string): string {
  return join(runArtifactsDir(cwd, runId), 'actions.json')
}

export function runDiffPath(cwd: string, runId: string): string {
  return join(runArtifactsDir(cwd, runId), 'diff.patch')
}

export function runTestsLogPath(cwd: string, runId: string): string {
  return join(runArtifactsDir(cwd, runId), 'tests.log')
}

export function runReportPath(cwd: string, runId: string): string {
  return join(runArtifactsDir(cwd, runId), 'report.md')
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

function writeJsonArtifact(
  cwd: string,
  runId: string,
  path: string,
  value: unknown,
  artifact: Omit<RunArtifact, 'at'>,
): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  addRunArtifact(cwd, runId, artifact)
}

export function writeRunPlan(
  cwd: string,
  runId: string,
  plan: Record<string, unknown>,
): string {
  const path = runPlanPath(cwd, runId)
  writeJsonArtifact(cwd, runId, path, {
    version: 1,
    runId,
    cwd,
    createdAt: now(),
    ...plan,
  }, {
    kind: 'plan',
    path: 'plan.json',
    title: 'plan.json',
  })
  return path
}

export function readRunActions(cwd: string, runId: string): RunTraceAction[] {
  const path = runActionsPath(cwd, runId)
  if (!existsSync(path)) return []
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return Array.isArray(parsed)
    ? parsed.filter((item): item is RunTraceAction => {
        if (!item || typeof item !== 'object') return false
        const obj = item as Record<string, unknown>
        return typeof obj.at === 'string' && typeof obj.kind === 'string'
      })
    : []
}

export function appendRunAction(
  cwd: string,
  runId: string,
  action: Omit<RunTraceAction, 'at'> & { at?: string },
): RunTraceAction {
  const path = runActionsPath(cwd, runId)
  mkdirSync(dirname(path), { recursive: true })
  const full: RunTraceAction = {
    ...action,
    at: action.at ?? now(),
  }
  const actions = [...readRunActions(cwd, runId), full]
  writeFileSync(path, `${JSON.stringify(actions, null, 2)}\n`)
  addRunArtifact(cwd, runId, {
    kind: 'actions',
    path: 'actions.json',
    title: 'actions.json',
  })
  return full
}

export function writeRunDiff(cwd: string, runId: string, diff: string): string {
  const path = runDiffPath(cwd, runId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, diff)
  addRunArtifact(cwd, runId, {
    kind: 'diff',
    path: 'diff.patch',
    title: 'diff.patch',
  })
  return path
}

export function appendRunTestsLog(
  cwd: string,
  runId: string,
  text: string,
): string {
  const path = runTestsLogPath(cwd, runId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, { flag: 'a' })
  addRunArtifact(cwd, runId, {
    kind: 'tests-log',
    path: 'tests.log',
    title: 'tests.log',
  })
  return path
}

export function writeRunReport(
  cwd: string,
  runId: string,
  markdown: string,
): string {
  const path = runReportPath(cwd, runId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, markdown.endsWith('\n') ? markdown : `${markdown}\n`)
  addRunArtifact(cwd, runId, {
    kind: 'report',
    path: 'report.md',
    title: 'report.md',
  })
  return path
}

export function initializeResearchTrace(
  cwd: string,
  runId: string,
  plan: Record<string, unknown> = {},
): RunManifest {
  if (!existsSync(runPlanPath(cwd, runId))) {
    writeRunPlan(cwd, runId, plan)
  }
  if (!existsSync(runActionsPath(cwd, runId))) {
    writeJsonArtifact(cwd, runId, runActionsPath(cwd, runId), [], {
      kind: 'actions',
      path: 'actions.json',
      title: 'actions.json',
    })
  }
  if (!existsSync(runDiffPath(cwd, runId))) {
    writeRunDiff(cwd, runId, '')
  }
  if (!existsSync(runTestsLogPath(cwd, runId))) {
    appendRunTestsLog(cwd, runId, '')
  }
  if (!existsSync(runReportPath(cwd, runId))) {
    writeRunReport(cwd, runId, [
      `# UR Run ${runId}`,
      '',
      'Status: initialized',
      '',
      'This local research trace is stored under `.ur/runs/` and is not uploaded by UR.',
    ].join('\n'))
  }
  return readRunManifest(cwd, runId) ?? upsertRunManifest(cwd, runId, manifest => manifest)
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
  const absolute = resolve(runArtifactsDir(cwd, runId), relativePath)
  // Only allow paths inside the run artifact directory.
  const base = resolve(runArtifactsDir(cwd, runId))
  if (absolute !== base && !absolute.startsWith(`${base}/`)) {
    throw new Error(`Artifact path escapes run directory: ${relativePath}`)
  }
  return absolute
}
