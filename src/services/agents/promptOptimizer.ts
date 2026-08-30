import type { EvalReport } from './evals.js'

export type PromptCandidate = {
  id: string
  prompt: string
  report: EvalReport
}

export type PromptOptimizationConstraints = {
  /** Aggregate pass-rate loss allowed versus baseline. Default: none. */
  maxPassRateRegression?: number
  /** Per-category pass-rate loss allowed versus baseline. Default: none. */
  maxCategoryRegression?: number
  /** Relative aggregate cost increase allowed. Default: 10%. */
  maxCostIncreaseRatio?: number
  /** Relative latency increase allowed. Default: 10%. */
  maxDurationIncreaseRatio?: number
}

export type PromptCandidateAssessment = {
  id: string
  accepted: boolean
  rejectionReasons: string[]
  paretoOptimal: boolean
  passRate: number
  promptChars: number
  totalCostUSD?: number
  totalDurationMs: number
}

export type PromptOptimizationResult = {
  baselineId: string
  selectedId: string
  rolledBack: boolean
  paretoFront: string[]
  assessments: PromptCandidateAssessment[]
}

function categoryRate(
  report: EvalReport,
  category: string,
): number | undefined {
  const bucket = report.byCategory[category]
  return bucket && bucket.total > 0 ? bucket.passed / bucket.total : undefined
}

function relativeIncrease(
  candidate: number | undefined,
  baseline: number | undefined,
): number | undefined {
  if (candidate === undefined || baseline === undefined) return undefined
  if (baseline === 0) return candidate === 0 ? 0 : Number.POSITIVE_INFINITY
  return (candidate - baseline) / baseline
}

function assess(
  candidate: PromptCandidate,
  baseline: PromptCandidate,
  constraints: PromptOptimizationConstraints,
): PromptCandidateAssessment {
  const reasons: string[] = []
  const maxPassRegression = constraints.maxPassRateRegression ?? 0
  if (baseline.report.passRate - candidate.report.passRate > maxPassRegression) {
    reasons.push('aggregate pass-rate regression')
  }

  const maxCategoryRegression = constraints.maxCategoryRegression ?? 0
  for (const category of Object.keys(baseline.report.byCategory)) {
    const before = categoryRate(baseline.report, category)
    const after = categoryRate(candidate.report, category)
    if (
      before !== undefined &&
      (after === undefined || before - after > maxCategoryRegression)
    ) {
      reasons.push(`category regression: ${category}`)
    }
  }

  const costIncrease = relativeIncrease(
    candidate.report.totalCostUSD,
    baseline.report.totalCostUSD,
  )
  if (
    costIncrease !== undefined &&
    costIncrease > (constraints.maxCostIncreaseRatio ?? 0.1)
  ) {
    reasons.push('cost regression')
  }
  const durationIncrease = relativeIncrease(
    candidate.report.totalDurationMs,
    baseline.report.totalDurationMs,
  )
  if (
    durationIncrease !== undefined &&
    durationIncrease > (constraints.maxDurationIncreaseRatio ?? 0.1)
  ) {
    reasons.push('latency regression')
  }

  return {
    id: candidate.id,
    accepted: reasons.length === 0,
    rejectionReasons: reasons,
    paretoOptimal: false,
    passRate: candidate.report.passRate,
    promptChars: candidate.prompt.length,
    totalCostUSD: candidate.report.totalCostUSD,
    totalDurationMs: candidate.report.totalDurationMs,
  }
}

function noWorse(a: PromptCandidateAssessment, b: PromptCandidateAssessment): boolean {
  const costNoWorse =
    a.totalCostUSD === undefined ||
    b.totalCostUSD === undefined ||
    a.totalCostUSD <= b.totalCostUSD
  return (
    a.passRate >= b.passRate &&
    a.promptChars <= b.promptChars &&
    a.totalDurationMs <= b.totalDurationMs &&
    costNoWorse
  )
}

function strictlyBetter(
  a: PromptCandidateAssessment,
  b: PromptCandidateAssessment,
): boolean {
  return (
    a.passRate > b.passRate ||
    a.promptChars < b.promptChars ||
    a.totalDurationMs < b.totalDurationMs ||
    (a.totalCostUSD !== undefined &&
      b.totalCostUSD !== undefined &&
      a.totalCostUSD < b.totalCostUSD)
  )
}

/**
 * Regression-constrained Pareto selection. The baseline is always eligible,
 * so failure to find a safe improvement deterministically rolls back instead
 * of shipping a measured loss.
 */
export function optimizePromptCandidates(
  baseline: PromptCandidate,
  candidates: PromptCandidate[],
  constraints: PromptOptimizationConstraints = {},
): PromptOptimizationResult {
  const unique = new Map<string, PromptCandidate>([[baseline.id, baseline]])
  for (const candidate of candidates) {
    if (unique.has(candidate.id)) {
      throw new Error(`Duplicate prompt candidate id: ${candidate.id}`)
    }
    unique.set(candidate.id, candidate)
  }

  const assessments = [...unique.values()].map(candidate =>
    assess(candidate, baseline, constraints),
  )
  const baselineAssessment = assessments.find(item => item.id === baseline.id)!
  baselineAssessment.accepted = true
  baselineAssessment.rejectionReasons = []

  const accepted = assessments.filter(item => item.accepted)
  for (const candidate of accepted) {
    candidate.paretoOptimal = !accepted.some(
      other =>
        other.id !== candidate.id &&
        noWorse(other, candidate) &&
        strictlyBetter(other, candidate),
    )
  }

  const front = accepted.filter(item => item.paretoOptimal)
  const selected = [...front].sort(
    (a, b) =>
      b.passRate - a.passRate ||
      a.promptChars - b.promptChars ||
      (a.totalCostUSD ?? Number.POSITIVE_INFINITY) -
        (b.totalCostUSD ?? Number.POSITIVE_INFINITY) ||
      a.totalDurationMs - b.totalDurationMs ||
      a.id.localeCompare(b.id),
  )[0] ?? baselineAssessment

  return {
    baselineId: baseline.id,
    selectedId: selected.id,
    rolledBack: selected.id === baseline.id,
    paretoFront: front.map(item => item.id).sort(),
    assessments,
  }
}
