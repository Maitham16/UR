/**
 * In-loop model escalation (the local "Oracle").
 *
 * Picks two tiers from the locally installed Ollama models — a fast model for
 * routine edits and a strong model for hard reasoning, debugging, and review —
 * then runs a task on the fast tier and auto-escalates to the strong tier when
 * the cheap attempt fails, returns no verdict, or the task is hard up front.
 * Tier selection and difficulty assessment are pure functions over the model
 * list, so the policy is deterministic and testable without a running Ollama or
 * any model call. Mirrors Amp's Oracle, but local-first and capability-aware.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelCapability } from '../../commands/model-doctor/model-doctor.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import { routeIntent } from './intentRouter.js'
import { recordOutcome } from './learning.js'

export type Tier = 'fast' | 'oracle'

export type EscalationPolicy = {
  fast?: string
  oracle?: string
  autoEscalate?: boolean
}

export type TierSelection = {
  fast: string | null
  oracle: string | null
  sameModel: boolean
  reasons: string[]
}

export type Difficulty = {
  hard: boolean
  score: number
  signals: string[]
}

const HARD_KEYWORDS =
  /\b(debug|race condition|deadlock|concurren|distributed|architect|redesign|refactor|optimi[sz]e|proof|prove|why does|root cause|security|vulnerab|migrat|algorithm|complex|trade[\s-]?off)\b/i

/** Best model for hard reasoning: large context, code-tuned, cloud-backed. */
export function scoreOracle(model: ModelCapability): number {
  let score = (model.contextLength ?? 0) / 1000
  if (model.likelyCode) score += 6
  if (/cloud/i.test(model.name)) score += 10
  if (model.size) score += model.size / 1e9
  if (model.advertisedCapabilities.includes('tools')) score += 2
  return score
}

/** Cheapest viable model: code-capable preferred, then smallest on disk. */
export function scoreFast(model: ModelCapability): number {
  let score = 0
  if (model.likelyCode) score += 4
  if (/cloud/i.test(model.name)) score -= 6
  score -= (model.size ?? Number.MAX_SAFE_INTEGER) / 1e9
  return score
}

export function selectTiers(
  models: ModelCapability[],
  policy: EscalationPolicy = {},
): TierSelection {
  const reasons: string[] = []
  const byName = (name?: string) =>
    name ? (models.find(m => m.name === name)?.name ?? name) : null

  if (models.length === 0 && !policy.fast && !policy.oracle) {
    return {
      fast: null,
      oracle: null,
      sameModel: false,
      reasons: ['No local Ollama models found; start Ollama or pull a model.'],
    }
  }

  let oracle = byName(policy.oracle)
  if (oracle && policy.oracle) reasons.push(`oracle pinned to ${oracle} by policy`)
  if (!oracle && models.length > 0) {
    const ranked = [...models].sort((a, b) => scoreOracle(b) - scoreOracle(a))
    oracle = ranked[0].name
    reasons.push(`oracle = ${oracle} (strongest reasoning/context fit)`)
  }

  let fast = byName(policy.fast)
  if (fast && policy.fast) reasons.push(`fast pinned to ${fast} by policy`)
  if (!fast && models.length > 0) {
    const ranked = [...models]
      .filter(m => m.name !== oracle || models.length === 1)
      .sort((a, b) => scoreFast(b) - scoreFast(a))
    fast = (ranked[0] ?? models[0]).name
    reasons.push(`fast = ${fast} (cheapest code-capable model)`)
  }

  const sameModel = !!fast && fast === oracle
  if (sameModel) {
    reasons.push('only one model available: fast and oracle are the same; escalation is a no-op')
  }
  return { fast, oracle, sameModel, reasons }
}

export type AssessOptions = {
  /** Learned difficulty bias from `ur learn` (history of fast-tier failures). */
  bias?: number
}

export function assessDifficulty(
  task: string,
  options: AssessOptions = {},
): Difficulty {
  const route = routeIntent(task)
  const signals: string[] = []
  let score = route.complexity
  if (route.complexity > 0) signals.push(`complexity ${route.complexity}`)
  if (route.category === 'review' || route.category === 'security') {
    score += 4
    signals.push(`${route.category} task`)
  }
  if (HARD_KEYWORDS.test(task)) {
    score += 5
    signals.push('hard-reasoning keywords')
  }
  if (task.length > 600) {
    score += 2
    signals.push('long prompt')
  }
  if (options.bias && options.bias > 0) {
    score += options.bias
    signals.push(`learned bias +${options.bias}`)
  }
  return { hard: score >= 5, score, signals }
}

export type EscalationPlan = {
  task: string
  tiers: TierSelection
  difficulty: Difficulty
  startTier: Tier
  rationale: string
}

export function planEscalation(
  task: string,
  models: ModelCapability[],
  policy: EscalationPolicy = {},
  options: AssessOptions = {},
): EscalationPlan {
  const tiers = selectTiers(models, policy)
  const difficulty = assessDifficulty(task, options)
  const startTier: Tier = difficulty.hard && tiers.oracle ? 'oracle' : 'fast'
  let rationale: string
  if (!tiers.fast && !tiers.oracle) {
    rationale = 'No local models available; start Ollama or pull a model.'
  } else if (startTier === 'oracle') {
    rationale = `Hard task (${difficulty.signals.join(', ') || 'flagged'}): start on the oracle.`
  } else if (difficulty.hard) {
    rationale = `Hard task, but no separate oracle is available: running on ${tiers.fast}.`
  } else {
    rationale = `Routine task: start on the fast model${
      tiers.sameModel ? '' : '; escalate to the oracle only if it fails'
    }.`
  }
  return { task: task.trim(), tiers, difficulty, startTier, rationale }
}

export type EscalationAttempt = {
  tier: Tier
  model: string | null
  verdict: string | null
  isError: boolean
  output: string
}

export type EscalationResult = {
  task: string
  plan: EscalationPlan
  attempts: EscalationAttempt[]
  escalated: boolean
  finalTier: Tier
  output: string
}

export type RunEscalationOptions = {
  cwd: string
  models: ModelCapability[]
  policy?: EscalationPolicy
  dryRun?: boolean
  forceOracle?: boolean
  maxTurns?: number
  skipPermissions?: boolean
  runner?: HeadlessRunner
  /** Learned difficulty bias from `ur learn`. */
  bias?: number
}

/** Decide whether a fast-tier result warrants a second opinion from the oracle. */
export function needsEscalation(output: {
  verdict?: string | null
  isError?: boolean
  output: string
}): boolean {
  if (output.isError) return true
  if (output.verdict === 'FAIL' || output.verdict === 'PARTIAL') return true
  if (!output.verdict && output.output.trim().length < 40) return true
  return false
}

export async function runWithEscalation(
  task: string,
  options: RunEscalationOptions,
): Promise<EscalationResult> {
  const plan = planEscalation(task, options.models, options.policy, {
    bias: options.bias,
  })
  const runner =
    options.runner ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
  const autoEscalate = options.policy?.autoEscalate ?? true
  const attempts: EscalationAttempt[] = []

  const run = async (tier: Tier): Promise<EscalationAttempt> => {
    const model = tier === 'oracle' ? plan.tiers.oracle : plan.tiers.fast
    const prior = attempts.length
      ? `\n\nThe fast model already attempted this and was inconclusive:\n${attempts[attempts.length - 1].output.slice(0, 1200)}\n\nProvide a stronger, correct solution.`
      : ''
    const out = await runner({
      cwd: options.cwd,
      prompt: `${task}${prior}\n\nEnd your reply with VERDICT: PASS or VERDICT: FAIL.`,
      model: model ?? undefined,
      maxTurns: options.maxTurns,
      skipPermissions: options.skipPermissions,
    })
    const attempt: EscalationAttempt = {
      tier,
      model,
      verdict: out.verdict ?? null,
      isError: !!out.isError,
      output: out.output,
    }
    attempts.push(attempt)
    return attempt
  }

  const forceOracle = options.forceOracle && plan.tiers.oracle
  const startTier: Tier = forceOracle ? 'oracle' : plan.startTier
  const first = await run(startTier)

  let escalated = false
  if (
    startTier === 'fast' &&
    !plan.tiers.sameModel &&
    plan.tiers.oracle &&
    autoEscalate &&
    needsEscalation(first)
  ) {
    escalated = true
    await run('oracle')
  }

  const final = attempts[attempts.length - 1]

  // Automatic learning: every attempt teaches which tier this category of
  // task really needs. The recorded pass/fail per model feeds difficultyBias
  // (already consumed by planEscalation callers) and learnedModelForTask,
  // so future runs start on the right tier without burning a failed
  // fast-tier round — that is where the token savings come from.
  if (!options.dryRun) {
    const escRunId = Date.now().toString(36)
    for (const attempt of attempts) {
      recordOutcome(options.cwd, {
        id: `esc-${escRunId}-${attempt.tier}`,
        task,
        model: attempt.model,
        pass: attempt.verdict === 'PASS' && !attempt.isError,
        detail: `escalation ${attempt.tier} ${attempt.verdict ?? 'no-verdict'}`,
      })
    }
  }

  return {
    task: task.trim(),
    plan,
    attempts,
    escalated,
    finalTier: final.tier,
    output: final.output,
  }
}

export type OracleOptions = {
  cwd: string
  models: ModelCapability[]
  policy?: EscalationPolicy
  dryRun?: boolean
  runner?: HeadlessRunner
  maxTurns?: number
}

/** One-shot second opinion from the strongest local model. */
export async function consultOracle(
  question: string,
  options: OracleOptions,
): Promise<{ model: string | null; output: string; verdict: string | null }> {
  const tiers = selectTiers(options.models, options.policy)
  const runner =
    options.runner ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
  const out = await runner({
    cwd: options.cwd,
    prompt: `Act as the Oracle: a careful second-opinion reviewer. Analyze the following and give the most rigorous, correct answer. Call out flaws, edge cases, and a concrete recommendation.\n\n${question}`,
    model: tiers.oracle ?? undefined,
    maxTurns: options.maxTurns,
  })
  return { model: tiers.oracle, output: out.output, verdict: out.verdict ?? null }
}

function policyPath(cwd: string): string {
  return join(cwd, '.ur', 'escalation.json')
}

export function loadPolicy(cwd: string): EscalationPolicy {
  const path = policyPath(cwd)
  if (!existsSync(path)) return {}
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object' ? (parsed as EscalationPolicy) : {}
}

export function savePolicy(cwd: string, policy: EscalationPolicy): void {
  mkdirSync(join(cwd, '.ur'), { recursive: true })
  writeFileSync(policyPath(cwd), `${JSON.stringify(policy, null, 2)}\n`)
}

export function formatPlan(plan: EscalationPlan, json: boolean): string {
  if (json) return JSON.stringify(plan, null, 2)
  const lines = [
    `Task: ${plan.task || '<empty>'}`,
    '',
    `Fast model:   ${plan.tiers.fast ?? 'none'}`,
    `Oracle model: ${plan.tiers.oracle ?? 'none'}`,
    `Difficulty:   ${plan.difficulty.hard ? 'hard' : 'routine'} (score ${plan.difficulty.score})${
      plan.difficulty.signals.length ? ` — ${plan.difficulty.signals.join(', ')}` : ''
    }`,
    `Start tier:   ${plan.startTier}`,
    `Plan:         ${plan.rationale}`,
  ]
  if (plan.tiers.reasons.length) {
    lines.push('', 'Selection:')
    for (const r of plan.tiers.reasons) lines.push(`  - ${r}`)
  }
  return lines.join('\n')
}

export function formatEscalationResult(result: EscalationResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `Task: ${result.task}`,
    `Escalated: ${result.escalated ? 'yes' : 'no'}   Final tier: ${result.finalTier}`,
    '',
  ]
  for (const a of result.attempts) {
    lines.push(
      `${a.tier === 'oracle' ? '◆' : '○'} ${a.tier} [${a.model ?? 'auto'}] → ${
        a.isError ? 'error' : (a.verdict ?? 'no verdict')
      }`,
    )
    lines.push(`    ${a.output.replace(/\s+/g, ' ').trim().slice(0, 200)}`)
  }
  return lines.join('\n')
}
