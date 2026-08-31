import type { EvalReport } from './evals.js'

export type PromptCandidateTrial = {
  /** Shared by baseline and every candidate evaluated in the same paired block. */
  key: string
  model?: string
  effort?: string
  repeat: number
  report: EvalReport
}

export type PromptCandidate = {
  id: string
  prompt: string
  /** Aggregate report used by existing consumers and Pareto ranking. */
  report: EvalReport
  /** Optional paired/repeated evidence used for confidence-aware promotion. */
  trials?: PromptCandidateTrial[]
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
  /** Smallest pass-rate gain considered material. Default: 0. */
  minPassRateImprovement?: number
  /** Require a positive 95% paired confidence bound before promotion. */
  requireStatisticalConfidence?: boolean
  /** Minimum number of repeated/matrix blocks needed for promotion. Default: 2. */
  minTrialPairs?: number
}

export type PromptCandidateAssessment = {
  id: string
  accepted: boolean
  rejectionReasons: string[]
  /** Evidence problems that block promotion without calling the candidate a regression. */
  promotionBlockers: string[]
  promotionEligible: boolean
  paretoOptimal: boolean
  passRate: number
  passRateDelta: number
  promptChars: number
  totalCostUSD?: number
  totalDurationMs: number
  pairedObservations: number
  pairedWins: number
  pairedLosses: number
  trialPairs: number
  confidence: 'baseline' | 'low' | 'medium' | 'high'
  confidenceInterval95?: { lower: number; upper: number }
  marginal: boolean
}

export type PromptOptimizationResult = {
  baselineId: string
  selectedId: string
  rolledBack: boolean
  paretoFront: string[]
  /** Pareto front before confidence/evidence promotion gates are applied. */
  measuredParetoFront: string[]
  promotionStatus:
    | 'promoted'
    | 'baseline-best'
    | 'insufficient-evidence'
    | 'regression-rollback'
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

function clampRate(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

type PairedEvidence = {
  observations: number[]
  trialPairs: number
}

function reportCaseDifferences(
  baseline: EvalReport,
  candidate: EvalReport,
): number[] {
  if (baseline.cases.length === 0 || candidate.cases.length === 0) return []
  const baselineCases = new Map(
    baseline.cases.map(item => [item.id, item.passed] as const),
  )
  return candidate.cases.flatMap(item => {
    const before = baselineCases.get(item.id)
    return before === undefined ? [] : [Number(item.passed) - Number(before)]
  })
}

function pairedEvidence(
  baseline: PromptCandidate,
  candidate: PromptCandidate,
): PairedEvidence {
  const baselineTrials = new Map(
    (baseline.trials ?? []).map(trial => [trial.key, trial] as const),
  )
  const observations: number[] = []
  let trialPairs = 0

  for (const trial of candidate.trials ?? []) {
    const before = baselineTrials.get(trial.key)
    if (!before) continue
    trialPairs += 1
    const caseDifferences = reportCaseDifferences(before.report, trial.report)
    if (caseDifferences.length > 0) observations.push(...caseDifferences)
    else observations.push(trial.report.passRate - before.report.passRate)
  }

  if (trialPairs > 0) return { observations, trialPairs }

  const caseDifferences = reportCaseDifferences(baseline.report, candidate.report)
  return {
    observations:
      caseDifferences.length > 0
        ? caseDifferences
        : [candidate.report.passRate - baseline.report.passRate],
    trialPairs: 1,
  }
}

function confidenceFor(
  evidence: PairedEvidence,
  minimumImprovement: number,
): Pick<
  PromptCandidateAssessment,
  | 'pairedObservations'
  | 'pairedWins'
  | 'pairedLosses'
  | 'trialPairs'
  | 'confidence'
  | 'confidenceInterval95'
  | 'marginal'
> {
  const { observations, trialPairs } = evidence
  const n = observations.length
  if (n === 0) {
    return {
      pairedObservations: 0,
      pairedWins: 0,
      pairedLosses: 0,
      trialPairs,
      confidence: 'low',
      confidenceInterval95: undefined,
      marginal: true,
    }
  }

  const mean = observations.reduce((sum, value) => sum + value, 0) / n
  const sampleVariance =
    n > 1
      ? observations.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (n - 1)
      : 0
  // A small continuity floor prevents identical tiny samples from reporting
  // zero uncertainty. It vanishes as paired observations accumulate.
  const standardError = Math.max(
    Math.sqrt(sampleVariance / n),
    0.25 / n,
  )
  const interval95 = {
    lower: clampRate(mean - 1.96 * standardError),
    upper: clampRate(mean + 1.96 * standardError),
  }
  const lower80 = mean - 1.2816 * standardError
  const confidence =
    interval95.lower > minimumImprovement
      ? 'high'
      : lower80 > minimumImprovement
        ? 'medium'
        : 'low'

  return {
    pairedObservations: n,
    pairedWins: observations.filter(value => value > 0).length,
    pairedLosses: observations.filter(value => value < 0).length,
    trialPairs,
    confidence,
    confidenceInterval95: interval95,
    marginal: mean > minimumImprovement && interval95.lower <= minimumImprovement,
  }
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

  const minimumImprovement = constraints.minPassRateImprovement ?? 0
  const evidence = confidenceFor(
    pairedEvidence(baseline, candidate),
    minimumImprovement,
  )
  const promotionBlockers: string[] = []
  if (constraints.requireStatisticalConfidence) {
    const minimumTrialPairs = constraints.minTrialPairs ?? 2
    if (evidence.trialPairs < minimumTrialPairs) {
      promotionBlockers.push(
        `insufficient repeated trial pairs (${evidence.trialPairs}/${minimumTrialPairs})`,
      )
    }
    const passRateDelta = candidate.report.passRate - baseline.report.passRate
    if (passRateDelta > minimumImprovement && evidence.confidence !== 'high') {
      promotionBlockers.push('pass-rate improvement is inside the 95% uncertainty interval')
    } else if (passRateDelta < minimumImprovement) {
      promotionBlockers.push('no material pass-rate improvement')
    } else if (
      passRateDelta === minimumImprovement &&
      evidence.pairedLosses > 0
    ) {
      promotionBlockers.push('quality outcomes are not paired-equivalent')
    }
  }

  return {
    id: candidate.id,
    accepted: reasons.length === 0,
    rejectionReasons: reasons,
    promotionBlockers,
    promotionEligible: reasons.length === 0 && promotionBlockers.length === 0,
    paretoOptimal: false,
    passRate: candidate.report.passRate,
    passRateDelta: candidate.report.passRate - baseline.report.passRate,
    promptChars: candidate.prompt.length,
    totalCostUSD: candidate.report.totalCostUSD,
    totalDurationMs: candidate.report.totalDurationMs,
    ...evidence,
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

function paretoFront(
  assessments: PromptCandidateAssessment[],
): PromptCandidateAssessment[] {
  return assessments.filter(
    candidate =>
      !assessments.some(
        other =>
          other.id !== candidate.id &&
          noWorse(other, candidate) &&
          strictlyBetter(other, candidate),
      ),
  )
}

function rankFront(front: PromptCandidateAssessment[]): PromptCandidateAssessment[] {
  return [...front].sort(
    (a, b) =>
      b.passRate - a.passRate ||
      a.promptChars - b.promptChars ||
      (a.totalCostUSD ?? Number.POSITIVE_INFINITY) -
        (b.totalCostUSD ?? Number.POSITIVE_INFINITY) ||
      a.totalDurationMs - b.totalDurationMs ||
      a.id.localeCompare(b.id),
  )
}

function sumOptional(
  reports: EvalReport[],
  pick: (report: EvalReport) => number | undefined,
): number | undefined {
  const values = reports.map(pick)
  return values.every((value): value is number => value !== undefined)
    ? values.reduce((sum, value) => sum + value, 0)
    : undefined
}

/** Build the backwards-compatible aggregate report used by Pareto ranking. */
export function aggregatePromptTrialReports(
  name: string,
  trials: PromptCandidateTrial[],
): EvalReport {
  if (trials.length === 0) throw new Error('cannot aggregate zero prompt trials')
  const reports = trials.map(trial => trial.report)
  const total = reports.reduce((sum, report) => sum + report.total, 0)
  const passed = reports.reduce((sum, report) => sum + report.passed, 0)
  const byCategory: EvalReport['byCategory'] = {}
  for (const report of reports) {
    for (const [category, bucket] of Object.entries(report.byCategory)) {
      const aggregate = byCategory[category] ?? { passed: 0, total: 0 }
      aggregate.passed += bucket.passed
      aggregate.total += bucket.total
      byCategory[category] = aggregate
    }
  }
  const testsPassed = sumOptional(reports, report => report.testsPassed)
  const testsFailed = sumOptional(reports, report => report.testsFailed)
  const trajectoryWeights = reports.filter(
    report => report.trajectoryScore !== undefined,
  )

  return {
    name,
    generatedAt: new Date().toISOString(),
    promptLifecycle: reports[0]?.promptLifecycle,
    total,
    passed,
    failed: total - passed,
    passRate: total > 0 ? passed / total : 0,
    byCategory,
    totalDurationMs: reports.reduce(
      (sum, report) => sum + report.totalDurationMs,
      0,
    ),
    totalCostUSD: sumOptional(reports, report => report.totalCostUSD),
    totalInputTokens: sumOptional(reports, report => report.totalInputTokens),
    totalOutputTokens: sumOptional(reports, report => report.totalOutputTokens),
    totalFilesChanged: sumOptional(reports, report => report.totalFilesChanged),
    totalEditCount: sumOptional(reports, report => report.totalEditCount),
    totalCommandFailures: sumOptional(
      reports,
      report => report.totalCommandFailures,
    ),
    totalHumanEditsNeeded: sumOptional(
      reports,
      report => report.totalHumanEditsNeeded,
    ),
    totalHumanInterventions: sumOptional(
      reports,
      report => report.totalHumanInterventions,
    ),
    totalRollbacks: sumOptional(reports, report => report.totalRollbacks),
    testsPassed,
    testsFailed,
    testPassRate:
      testsPassed !== undefined &&
      testsFailed !== undefined &&
      testsPassed + testsFailed > 0
        ? testsPassed / (testsPassed + testsFailed)
        : undefined,
    trajectoryScore:
      trajectoryWeights.length > 0
        ? trajectoryWeights.reduce(
            (sum, report) => sum + (report.trajectoryScore ?? 0),
            0,
          ) / trajectoryWeights.length
        : undefined,
    cases: trials.flatMap(trial =>
      trial.report.cases.map(result => ({
        ...result,
        id: `${trial.key}:${result.id}`,
      })),
    ),
  }
}

/**
 * Regression-constrained, confidence-aware Pareto selection. The baseline is
 * always eligible. Repeated CLI evaluations can require statistical evidence;
 * legacy single-report callers keep their prior ranking behavior while still
 * receiving explicit uncertainty fields.
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
  baselineAssessment.promotionBlockers = []
  baselineAssessment.promotionEligible = true
  baselineAssessment.confidence = 'baseline'
  baselineAssessment.marginal = false

  const measuredFront = paretoFront(assessments.filter(item => item.accepted))
  const eligibleFront = paretoFront(
    assessments.filter(item => item.accepted && item.promotionEligible),
  )
  for (const candidate of eligibleFront) candidate.paretoOptimal = true

  const selected = rankFront(eligibleFront)[0] ?? baselineAssessment
  const bestMeasured = rankFront(measuredFront)[0] ?? baselineAssessment
  const blockedMeasuredWinner =
    bestMeasured.id !== baseline.id && !bestMeasured.promotionEligible
  const hasAcceptedCandidate = assessments.some(
    item => item.id !== baseline.id && item.accepted,
  )

  return {
    baselineId: baseline.id,
    selectedId: selected.id,
    rolledBack: selected.id === baseline.id,
    paretoFront: eligibleFront.map(item => item.id).sort(),
    measuredParetoFront: measuredFront.map(item => item.id).sort(),
    promotionStatus:
      selected.id !== baseline.id
        ? 'promoted'
        : blockedMeasuredWinner
          ? 'insufficient-evidence'
          : hasAcceptedCandidate
            ? 'baseline-best'
            : 'regression-rollback',
    assessments,
  }
}
