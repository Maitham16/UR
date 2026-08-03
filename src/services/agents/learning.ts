/**
 * Continual learning loop (UR's experiential memory).
 *
 * UR already stores and consolidates memory, but it never learned from its own
 * trajectories. This service closes that gap, local-first: it mines completed
 * work — verifiable artifacts (test runs, approved/rejected diffs), CI-loop
 * outcomes, and escalation attempts — into (a) a per-category / per-model
 * success-rate store that `escalate`, `arena`, and `model-route` can consult to
 * tune their tier and model picks, and (b) reflective "lessons" distilled by an
 * injected model runner. Mining and folding are pure and deterministic; the
 * reflection step is behind an injectable runner, so the core is testable with
 * no Ollama and no model call. Mirrors Letta/MemGPT skill-learning and Reflexion.
 */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { safeParseJSON } from '../../utils/json.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import type { Artifact } from './artifacts.js'
import { listArtifacts } from './artifacts.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import { routeIntent } from './intentRouter.js'
import { lockSync } from '../../utils/lockfile.js'

export type Tally = { pass: number; fail: number }

export type LearnStats = {
  version: 1
  updatedAt: string
  /** Outcomes folded in so far, for incremental, idempotent mining. */
  seen: string[]
  models: Record<string, Tally>
  categories: Record<string, Tally>
  /** model -> category -> tally */
  modelByCategory: Record<string, Record<string, Tally>>
  lessons: string[]
}

export type Outcome = {
  /** Stable id so re-running `ur learn` never double-counts the same record. */
  key: string
  category: string
  model: string | null
  pass: boolean
  detail: string
}

export function emptyStats(): LearnStats {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    seen: [],
    models: {},
    categories: {},
    modelByCategory: {},
    lessons: [],
  }
}

function tally(record: Record<string, Tally>, key: string, pass: boolean): void {
  const bucket = (record[key] ??= { pass: 0, fail: 0 })
  if (pass) bucket.pass += 1
  else bucket.fail += 1
}

/** Fold new outcomes into stats, skipping any already-seen key. Pure. */
export function foldOutcomes(stats: LearnStats, outcomes: Outcome[]): LearnStats {
  const next: LearnStats = {
    ...stats,
    seen: [...stats.seen],
    models: cloneTallies(stats.models),
    categories: cloneTallies(stats.categories),
    modelByCategory: Object.fromEntries(
      Object.entries(stats.modelByCategory).map(([model, categories]) => [
        model,
        cloneTallies(categories),
      ]),
    ),
    lessons: [...stats.lessons],
  }
  const seen = new Set(next.seen)
  for (const outcome of outcomes) {
    if (seen.has(outcome.key)) continue
    seen.add(outcome.key)
    next.seen.push(outcome.key)
    tally(next.categories, outcome.category, outcome.pass)
    if (outcome.model) {
      tally(next.models, outcome.model, outcome.pass)
      const perModel = (next.modelByCategory[outcome.model] ??= {})
      tally(perModel, outcome.category, outcome.pass)
    }
  }
  next.updatedAt = new Date().toISOString()
  return next
}

function cloneTallies(record: Record<string, Tally>): Record<string, Tally> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, { ...value }]),
  )
}

const TEST_PASS_RE = /^passed$/i
const TEST_FAIL_RE = /^failed/i

/** Derive outcomes from the verifiable-artifacts manifest. Pure. */
export function mineArtifacts(artifacts: Artifact[]): Outcome[] {
  const outcomes: Outcome[] = []
  for (const artifact of artifacts) {
    const category = categoryFromText(`${artifact.title} ${artifact.summary ?? ''}`)
    if (artifact.kind === 'test-run' && artifact.summary) {
      if (TEST_PASS_RE.test(artifact.summary)) {
        outcomes.push({
          key: `artifact:${artifact.id}:${artifact.updatedAt}`,
          category,
          model: null,
          pass: true,
          detail: artifact.title,
        })
      } else if (TEST_FAIL_RE.test(artifact.summary)) {
        outcomes.push({
          key: `artifact:${artifact.id}:${artifact.updatedAt}`,
          category,
          model: null,
          pass: false,
          detail: `${artifact.title} — ${artifact.summary}`,
        })
      }
    }
    if (
      (artifact.kind === 'diff' || artifact.kind === 'plan') &&
      artifact.status !== 'pending'
    ) {
      outcomes.push({
        key: `artifact:${artifact.id}:${artifact.status}:${artifact.updatedAt}`,
        category,
        model: null,
        pass: artifact.status === 'approved',
        detail: `${artifact.kind} ${artifact.title} ${artifact.status}`,
      })
    }
  }
  return outcomes
}

/** An explicit run outcome (escalation/arena/ci-loop) folded by the caller. Pure. */
export function outcomeFromRun(input: {
  id: string
  task: string
  model: string | null
  pass: boolean
  detail?: string
}): Outcome {
  return {
    key: `run:${input.id}`,
    category: categoryFromText(input.task),
    model: input.model,
    pass: input.pass,
    detail: input.detail ?? input.task.slice(0, 120),
  }
}

function categoryFromText(text: string): string {
  return routeIntent(text).category || 'general'
}

/** Learned difficulty bias for a task (routes the task to a category first). */
export function taskDifficultyBias(stats: LearnStats, task: string): number {
  return difficultyBias(stats, categoryFromText(task))
}

export function rate(tally: Tally | undefined): number | null {
  if (!tally) return null
  const total = tally.pass + tally.fail
  return total === 0 ? null : tally.pass / total
}

export function successRate(
  stats: LearnStats,
  query: { category?: string; model?: string },
): number | null {
  if (query.model && query.category) {
    return rate(stats.modelByCategory[query.model]?.[query.category])
  }
  if (query.model) return rate(stats.models[query.model])
  if (query.category) return rate(stats.categories[query.category])
  return null
}

/**
 * Best model for a category by learned success rate. Requires a minimum sample
 * so one lucky run cannot pin a model; returns null when evidence is thin.
 */
export function bestModelForCategory(
  stats: LearnStats,
  category: string,
  minSamples = 5,
): { model: string; rate: number } | null {
  let best: { model: string; rate: number; confidence: number } | null = null
  for (const [model, byCat] of Object.entries(stats.modelByCategory)) {
    const t = byCat[category]
    if (!t || t.pass + t.fail < minSamples) continue
    const r = t.pass / (t.pass + t.fail)
    const confidence = wilsonLowerBound(t.pass, t.pass + t.fail)
    if (
      !best ||
      confidence > best.confidence ||
      (confidence === best.confidence &&
        (r > best.rate || (r === best.rate && model < best.model)))
    ) {
      best = { model, rate: r, confidence }
    }
  }
  return best ? { model: best.model, rate: best.rate } : null
}

function wilsonLowerBound(successes: number, samples: number): number {
  if (samples <= 0) return 0
  const z = 1.96
  const rate = successes / samples
  const zSquared = z * z
  return (
    rate + zSquared / (2 * samples) -
    z * Math.sqrt((rate * (1 - rate) + zSquared / (4 * samples)) / samples)
  ) / (1 + zSquared / samples)
}

/**
 * How strongly history says a category needs the strong model. >0 nudges the
 * difficulty score up (toward starting on / escalating to the oracle); 0 when
 * evidence is thin or the fast path is reliable.
 */
export function difficultyBias(
  stats: LearnStats,
  category: string,
  minSamples = 3,
): number {
  const t = stats.categories[category]
  if (!t || t.pass + t.fail < minSamples) return 0
  const r = t.pass / (t.pass + t.fail)
  if (r >= 0.8) return 0
  if (r >= 0.5) return 2
  return 4
}

function learningDir(cwd: string): string {
  return join(cwd, '.ur', 'learning')
}

function statsPath(cwd: string): string {
  return join(learningDir(cwd), 'stats.json')
}

function learningLockPath(cwd: string): string {
  return join(learningDir(cwd), 'stats.mutation-lock')
}

const learningLockWaitArray = new Int32Array(new SharedArrayBuffer(4))

function withLearningLock<T>(cwd: string, operation: () => T): T {
  mkdirSync(learningDir(cwd), { recursive: true })
  const path = learningLockPath(cwd)
  writeFileSync(path, '', { flag: 'a', mode: 0o600 })
  let lastError: unknown
  for (let attempt = 0; attempt < 21; attempt++) {
    try {
      const release = lockSync(path, { realpath: false, stale: 30_000 })
      try {
        return operation()
      } finally {
        release()
      }
    } catch (error) {
      lastError = error
      if (
        (error as NodeJS.ErrnoException).code !== 'ELOCKED' ||
        attempt === 20
      ) {
        throw error
      }
      Atomics.wait(
        learningLockWaitArray,
        0,
        0,
        Math.min(100, 10 + attempt * 5),
      )
    }
  }
  throw lastError
}

function asTally(value: unknown): Tally | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const tally = value as Record<string, unknown>
  if (
    typeof tally.pass !== 'number' ||
    !Number.isSafeInteger(tally.pass) ||
    tally.pass < 0 ||
    typeof tally.fail !== 'number' ||
    !Number.isSafeInteger(tally.fail) ||
    tally.fail < 0
  ) {
    return null
  }
  return { pass: tally.pass, fail: tally.fail }
}

function normalizeTallies(value: unknown): Record<string, Tally> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, Tally> = {}
  for (const [key, candidate] of Object.entries(value)) {
    const tally = asTally(candidate)
    if (tally) normalized[key] = tally
  }
  return normalized
}

function normalizeStats(value: unknown): LearnStats {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyStats()
  }
  const record = value as Record<string, unknown>
  const modelByCategory: LearnStats['modelByCategory'] = {}
  if (
    record.modelByCategory &&
    typeof record.modelByCategory === 'object' &&
    !Array.isArray(record.modelByCategory)
  ) {
    for (const [model, categories] of Object.entries(
      record.modelByCategory,
    )) {
      modelByCategory[model] = normalizeTallies(categories)
    }
  }
  return {
    version: 1,
    updatedAt:
      typeof record.updatedAt === 'string'
        ? record.updatedAt
        : new Date(0).toISOString(),
    seen: Array.isArray(record.seen)
      ? [...new Set(record.seen.filter(value => typeof value === 'string'))]
      : [],
    models: normalizeTallies(record.models),
    categories: normalizeTallies(record.categories),
    modelByCategory,
    lessons: Array.isArray(record.lessons)
      ? [...new Set(record.lessons.filter(value => typeof value === 'string'))]
      : [],
  }
}

export function loadStats(cwd: string): LearnStats {
  const path = statsPath(cwd)
  if (!existsSync(path)) return emptyStats()
  try {
    return normalizeStats(safeParseJSON(readFileSync(path, 'utf-8'), false))
  } catch {
    return emptyStats()
  }
}

export function saveStats(cwd: string, stats: LearnStats): void {
  mkdirSync(learningDir(cwd), { recursive: true })
  const destination = statsPath(cwd)
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(normalizeStats(stats), null, 2)}\n`, {
      mode: 0o600,
    })
    renameSync(temporary, destination)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function isAutomaticLearningEnabled(): boolean {
  if (isEnvTruthy(process.env.UR_CODE_DISABLE_AUTO_LEARNING)) {
    return false
  }
  return getInitialSettings().automaticLearningEnabled !== false
}

/**
 * Fire-and-forget: fold one run outcome into the on-disk stats. Called
 * automatically when ci-loop / arena / escalation / test-first runs finish,
 * so the agent learns from every run without anyone invoking `/learn run`.
 * Pure JSON fold — no model calls, no tokens. Errors are swallowed because
 * learning must never break the run that produced the outcome; the folded
 * store is idempotent (outcome keys dedupe), so double-recording is safe.
 */
export function recordOutcome(
  cwd: string,
  input: {
    id: string
    task: string
    model: string | null
    pass: boolean
    detail?: string
  },
): void {
  recordOutcomes(cwd, [input])
}

export function recordOutcomes(
  cwd: string,
  inputs: Array<{
    id: string
    task: string
    model: string | null
    pass: boolean
    detail?: string
  }>,
): void {
  if (!isAutomaticLearningEnabled()) {
    return
  }
  if (inputs.length === 0) return
  try {
    withLearningLock(cwd, () => {
      saveStats(
        cwd,
        foldOutcomes(loadStats(cwd), inputs.map(outcomeFromRun)),
      )
    })
  } catch {
    // best-effort: a broken learning store must not fail the run
  }
}

/**
 * Evidence-based model preference for a task: the model with the best
 * learned success rate for the task's category, but only when the evidence
 * is solid (>= minSamples runs) and the track record is good (>= minRate).
 * Returns null when evidence is thin so callers keep their existing
 * heuristics — routing quality can only improve, never silently degrade.
 */
export function learnedModelForTask(
  stats: LearnStats,
  task: string,
  options: { minSamples?: number; minRate?: number } = {},
): string | null {
  const best = bestModelForCategory(
    stats,
    categoryFromText(task),
    options.minSamples ?? 5,
  )
  if (!best) return null
  return best.rate >= (options.minRate ?? 0.6) ? best.model : null
}

export type ReflectInput = {
  cwd: string
  failures: string[]
  runner?: HeadlessRunner
  dryRun?: boolean
  model?: string
  maxLessons?: number
}

/** Distill short, reusable lessons from recent failures via an injected model. */
export async function reflectOnFailures(input: ReflectInput): Promise<string[]> {
  if (input.failures.length === 0) return []
  const runner =
    input.runner ?? (input.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
  const max = input.maxLessons ?? 5
  const prompt =
    `You are reviewing this project's recent agent failures to extract durable, ` +
    `reusable lessons. For each, write one imperative sentence (a rule the agent ` +
    `should follow next time). Output at most ${max} lines, each starting with "- ".\n\n` +
    input.failures.map((f, i) => `${i + 1}. ${f}`).join('\n')
  const out = await runner({ cwd: input.cwd, prompt, model: input.model, maxTurns: 1 })
  return out.output
    .split('\n')
    .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(line => line.length > 0 && line.length <= 200)
    .slice(0, max)
}

export type LearnResult = {
  stats: LearnStats
  newOutcomes: number
  newLessons: string[]
}

export type LearnOptions = {
  cwd: string
  reflect?: boolean
  dryRun?: boolean
  runner?: HeadlessRunner
  extraOutcomes?: Outcome[]
}

/** One learning pass: mine artifacts (+ caller outcomes), fold, optionally reflect. */
export async function runLearn(options: LearnOptions): Promise<LearnResult> {
  const before = loadStats(options.cwd)
  const mined = [
    ...mineArtifacts(listArtifacts(options.cwd)),
    ...(options.extraOutcomes ?? []),
  ]
  const seen = new Set(before.seen)
  const fresh = mined.filter(outcome => !seen.has(outcome.key))
  let stats = foldOutcomes(before, mined)

  let newLessons: string[] = []
  if (options.reflect) {
    const failures = fresh.filter(o => !o.pass).map(o => o.detail)
    newLessons = await reflectOnFailures({
      cwd: options.cwd,
      failures,
      runner: options.runner,
      dryRun: options.dryRun,
    })
    const existing = new Set(stats.lessons)
    stats = { ...stats, lessons: [...stats.lessons, ...newLessons.filter(l => !existing.has(l))] }
  }

  if (!options.dryRun) {
    stats = withLearningLock(options.cwd, () => {
      const current = loadStats(options.cwd)
      const merged = foldOutcomes(current, mined)
      const lessons = [...new Set([...merged.lessons, ...newLessons])]
      const next = { ...merged, lessons }
      saveStats(options.cwd, next)
      return next
    })
  }
  return { stats, newOutcomes: fresh.length, newLessons }
}

/**
 * Auto-skillify: categories the agent has repeatedly succeeded at are
 * candidates for a reusable skill (the CODESKILL "self-evolving skills"
 * pattern). Pure suggestion — creation stays a human decision via
 * /create-skill or /skillify. A category qualifies with >= minPasses passes
 * at >= minRate and no existing skill whose name mentions the category.
 */
export function suggestSkillCandidates(
  stats: LearnStats,
  existingSkillNames: string[] = [],
  options: { minPasses?: number; minRate?: number } = {},
): Array<{ category: string; passes: number; rate: number; hint: string }> {
  const minPasses = options.minPasses ?? 5
  const minRate = options.minRate ?? 0.7
  const existing = existingSkillNames.map(n => n.toLowerCase())
  const out: Array<{ category: string; passes: number; rate: number; hint: string }> = []
  for (const [category, t] of Object.entries(stats.categories)) {
    const total = t.pass + t.fail
    if (t.pass < minPasses || total === 0) continue
    const r = t.pass / total
    if (r < minRate) continue
    if (existing.some(name => name.includes(category.toLowerCase()))) continue
    out.push({
      category,
      passes: t.pass,
      rate: r,
      hint: `You have ${t.pass} successful ${category} runs (${Math.round(r * 100)}%). Distill the repeatable steps into a skill: /create-skill ${category}-playbook or /skillify after the next ${category} run.`,
    })
  }
  return out.sort((a, b) => b.passes - a.passes)
}

export function formatStats(stats: LearnStats, json: boolean): string {
  if (json) return JSON.stringify(stats, null, 2)
  const fmt = (t: Tally) => {
    const total = t.pass + t.fail
    return `${t.pass}/${total} (${total ? Math.round((t.pass / total) * 100) : 0}%)`
  }
  const lines = ['UR learned stats', `Updated: ${stats.updatedAt}`, '']
  const cats = Object.entries(stats.categories).sort((a, b) => a[0].localeCompare(b[0]))
  if (cats.length) {
    lines.push('By category:')
    for (const [cat, t] of cats) lines.push(`  ${cat.padEnd(14)} ${fmt(t)}`)
    lines.push('')
  }
  const models = Object.entries(stats.models).sort((a, b) => a[0].localeCompare(b[0]))
  if (models.length) {
    lines.push('By model:')
    for (const [model, t] of models) lines.push(`  ${model.padEnd(28)} ${fmt(t)}`)
    lines.push('')
  }
  if (stats.lessons.length) {
    lines.push('Lessons:')
    for (const lesson of stats.lessons.slice(-10)) lines.push(`  - ${lesson}`)
  }
  const skillIdeas = suggestSkillCandidates(stats)
  if (skillIdeas.length) {
    lines.push('', 'Skill candidates (auto-skillify):')
    for (const idea of skillIdeas.slice(0, 5)) lines.push(`  - ${idea.hint}`)
  }
  if (cats.length === 0 && models.length === 0) {
    lines.push('No outcomes yet. Capture work with `ur artifacts`, then run `ur learn`.')
  }
  return lines.join('\n')
}

export function formatLearnResult(result: LearnResult, json: boolean): string {
  if (json) {
    return JSON.stringify(
      { newOutcomes: result.newOutcomes, newLessons: result.newLessons, stats: result.stats },
      null,
      2,
    )
  }
  const lines = [
    `Learned from ${result.newOutcomes} new outcome(s).`,
  ]
  if (result.newLessons.length) {
    lines.push('', 'New lessons:')
    for (const lesson of result.newLessons) lines.push(`  - ${lesson}`)
  }
  lines.push('', formatStats(result.stats, false))
  return lines.join('\n')
}
