import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  ensurePrivateDirectory,
  readPrivateText,
  withPrivateStateLock,
  writePrivateTextAtomic,
} from '../../utils/privateState.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  listRunIds,
  readRunActions,
  readRunManifest,
  type RunTraceAction,
} from './runArtifacts.js'
import type { ExecLoop } from './executor.js'
import { routeIntent } from './intentRouter.js'
import {
  loadWorkflow,
  saveWorkflow,
  type WorkflowSpec,
  type WorkflowStep,
  validateWorkflow,
  workflowPath,
} from './workflows.js'

export type LearnedPlaybookStatus =
  | 'candidate'
  | 'approved'
  | 'rejected'
  | 'disabled'

export type LearnedPlaybookEvidence = {
  runId: string
  manifestDigest: string
  proofKinds: string[]
  recordedAt: string
}

export type LearnedPlaybookCandidate = {
  version: 1
  id: string
  name: string
  status: LearnedPlaybookStatus
  revision: number
  match: {
    category: string
    actionFingerprint: string
    keywords: string[]
  }
  workflow: WorkflowSpec
  evidence: LearnedPlaybookEvidence[]
  metrics: {
    samples: number
    pass: number
    fail: number
    wilsonLowerBound: number
  }
  safety: {
    requiresApproval: true
    blockedReasons: string[]
  }
  createdAt: string
  updatedAt: string
  rejectionReason?: string
}

type LearnedPlaybookStore = {
  version: 1
  candidates: LearnedPlaybookCandidate[]
}

export type MinedRun = {
  runId: string
  task: string
  actions: RunTraceAction[]
  manifestDigest: string
  passed: boolean
  proofKinds: string[]
}

const STORE_MAX_BYTES = 8 * 1024 * 1024
const MAX_CANDIDATES = 500
const MAX_EVIDENCE_PER_CANDIDATE = 100
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/
const UNSAFE_COMMAND_RE =
  /(?:^|\s)(?:sudo|su|rm|rmdir|mkfs|dd|shutdown|reboot|killall)\b|(?:curl|wget)[^\n|]*\|\s*(?:sh|bash|zsh)\b|\b(?:npm|pnpm|yarn|bun)\s+publish\b|\bgit\s+push\b|\bgh\s+pr\s+(?:create|merge)\b|\b(?:deploy|release)\b/i
const SECRET_RE =
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|(?:password|token|secret)\s*[:=]\s*\S+)/i
const VERIFICATION_PROOF_RE =
  /(?:^|[\s:/_-])(?:test|verify|verification|gate|lint|compile|typecheck|check|build|vet)(?:$|[\s:/_-])/i

function learningDir(cwd: string): string {
  return join(cwd, '.ur', 'learning')
}

function storePath(cwd: string): string {
  return join(learningDir(cwd), 'playbooks.json')
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')}`
}

function emptyStore(): LearnedPlaybookStore {
  return { version: 1, candidates: [] }
}

function validCandidate(value: unknown): value is LearnedPlaybookCandidate {
  if (!value || typeof value !== 'object') return false
  const item = value as LearnedPlaybookCandidate
  return (
    item.version === 1 &&
    SAFE_ID_RE.test(item.id) &&
    typeof item.name === 'string' &&
    item.name.length > 0 &&
    item.name.length <= 128 &&
    ['candidate', 'approved', 'rejected', 'disabled'].includes(item.status) &&
    Number.isSafeInteger(item.revision) &&
    item.revision >= 1 &&
    typeof item.match?.category === 'string' &&
    item.match.category.length <= 128 &&
    typeof item.match?.actionFingerprint === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(item.match.actionFingerprint) &&
    Array.isArray(item.match?.keywords) &&
    item.match.keywords.length <= 12 &&
    item.match.keywords.every(
      keyword => typeof keyword === 'string' && keyword.length <= 128,
    ) &&
    Array.isArray(item.evidence) &&
    item.evidence.length <= MAX_EVIDENCE_PER_CANDIDATE &&
    item.evidence.every(
      evidence =>
        SAFE_ID_RE.test(evidence.runId) &&
        /^sha256:[a-f0-9]{64}$/.test(evidence.manifestDigest) &&
        Array.isArray(evidence.proofKinds) &&
        evidence.proofKinds.length <= 32 &&
        evidence.proofKinds.every(
          proof => typeof proof === 'string' && proof.length <= 128,
        ) &&
        Number.isFinite(Date.parse(evidence.recordedAt)),
    ) &&
    Number.isSafeInteger(item.metrics?.samples) &&
    Number.isSafeInteger(item.metrics?.pass) &&
    Number.isSafeInteger(item.metrics?.fail) &&
    item.metrics.samples >= 0 &&
    item.metrics.pass >= 0 &&
    item.metrics.fail >= 0 &&
    item.metrics.pass + item.metrics.fail === item.metrics.samples &&
    Number.isFinite(item.metrics.wilsonLowerBound) &&
    item.metrics.wilsonLowerBound >= 0 &&
    item.metrics.wilsonLowerBound <= 1 &&
    item.safety?.requiresApproval === true &&
    Array.isArray(item.safety.blockedReasons) &&
    item.safety.blockedReasons.length <= 32 &&
    item.safety.blockedReasons.every(
      reason => typeof reason === 'string' && reason.length <= 500,
    ) &&
    Number.isFinite(Date.parse(item.createdAt)) &&
    Number.isFinite(Date.parse(item.updatedAt)) &&
    (item.rejectionReason === undefined ||
      (typeof item.rejectionReason === 'string' &&
        item.rejectionReason.length <= 500)) &&
    Array.isArray(item.workflow?.steps) &&
    validateWorkflow(item.workflow).valid
  )
}

function loadStore(cwd: string): LearnedPlaybookStore {
  const raw = readPrivateText(learningDir(cwd), storePath(cwd), STORE_MAX_BYTES)
  if (raw === null) return emptyStore()
  const parsed = safeParseJSON(raw, false)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as LearnedPlaybookStore).version !== 1 ||
    !Array.isArray((parsed as LearnedPlaybookStore).candidates)
  ) {
    throw new Error('Learned playbook store is invalid')
  }
  const candidates = (parsed as LearnedPlaybookStore).candidates
  if (candidates.length > MAX_CANDIDATES || !candidates.every(validCandidate)) {
    throw new Error('Learned playbook store failed schema validation')
  }
  // safeParseJSON memoizes small inputs; never expose its cached object to
  // lifecycle mutations or dry-run previews.
  return { version: 1, candidates: structuredClone(candidates) }
}

function saveStore(cwd: string, store: LearnedPlaybookStore): void {
  if (store.candidates.length > MAX_CANDIDATES) {
    throw new Error(`Learned playbook store is limited to ${MAX_CANDIDATES} candidates`)
  }
  writePrivateTextAtomic(
    learningDir(cwd),
    storePath(cwd),
    `${JSON.stringify(store, null, 2)}\n`,
    STORE_MAX_BYTES,
  )
}

export function listLearnedPlaybooks(
  cwd: string,
  status?: LearnedPlaybookStatus,
): LearnedPlaybookCandidate[] {
  const values = loadStore(cwd).candidates
  return values
    .filter(candidate => status === undefined || candidate.status === status)
    .map(candidate => structuredClone(candidate))
}

export function getLearnedPlaybook(
  cwd: string,
  idOrName: string,
): LearnedPlaybookCandidate | null {
  const item = loadStore(cwd).candidates.find(
    candidate => candidate.id === idOrName || candidate.name === idOrName,
  )
  return item ? structuredClone(item) : null
}

function planTask(cwd: string, runId: string): string {
  const path = join(cwd, '.ur', 'runs', runId, 'plan.json')
  if (!existsSync(path)) return runId
  const raw = readPrivateText(
    join(cwd, '.ur', 'runs', runId),
    path,
    1024 * 1024,
  )
  if (!raw) return runId
  const parsed = safeParseJSON(raw, false) as Record<string, unknown> | null
  for (const key of ['task', 'goal', 'objective', 'workflow']) {
    if (typeof parsed?.[key] === 'string' && parsed[key].trim()) {
      return parsed[key].trim()
    }
  }
  return runId
}

function proofKinds(actions: RunTraceAction[]): string[] {
  return [
    ...new Set(
      actions
        .filter(
          action =>
            action.status === 'passed' &&
            action.exitCode === 0 &&
            Boolean(action.command?.trim()),
        )
        .filter(action =>
          VERIFICATION_PROOF_RE.test(
            `${action.kind} ${action.title ?? ''} ${action.command ?? ''}`,
          ),
        )
        .map(action => action.kind),
    ),
  ].sort()
}

function runPassed(actions: RunTraceAction[], proofs: string[]): boolean {
  if (actions.some(action => action.status === 'failed')) return false
  return proofs.length > 0
}

export function collectMinedRuns(cwd: string): MinedRun[] {
  return listRunIds(cwd)
    .sort()
    .flatMap(runId => {
      const manifest = readRunManifest(cwd, runId)
      if (!manifest) return []
      const actions = readRunActions(cwd, runId)
      const proofs = proofKinds(actions)
      return [
        {
          runId,
          task: planTask(cwd, runId),
          actions,
          manifestDigest: digest({ manifest, actions }),
          passed: runPassed(actions, proofs),
          proofKinds: proofs,
        },
      ]
    })
}

function canonicalAction(action: RunTraceAction): string | null {
  const command = action.command?.trim()
  if (command && (UNSAFE_COMMAND_RE.test(command) || SECRET_RE.test(command))) {
    return null
  }
  const raw = `${action.kind}:${action.title ?? ''}`
    .toLowerCase()
    .replace(/[0-9a-f]{7,64}/g, '<rev>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
  return raw.slice(0, 160) || null
}

export function learnedRunSafety(run: MinedRun): string[] {
  const reasons: string[] = []
  for (const action of run.actions) {
    const text = `${action.command ?? ''}\n${action.title ?? ''}\n${action.reason ?? ''}`
    if (UNSAFE_COMMAND_RE.test(text)) reasons.push('unsafe or external-side-effect command')
    if (SECRET_RE.test(text)) reasons.push('secret-like content')
  }
  return [...new Set(reasons)]
}

function actionSequence(run: MinedRun): string[] {
  const sequence = run.actions.map(canonicalAction).filter(Boolean) as string[]
  return [...new Set(sequence)].slice(0, 12)
}

function keywords(task: string): string[] {
  return [
    ...new Set(
      task
        .toLowerCase()
        .match(/[a-z][a-z0-9_-]{3,}/g)
        ?.filter(word => !['this', 'that', 'with', 'from', 'into'].includes(word)) ??
        [],
    ),
  ].slice(0, 12)
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'learned-playbook'
  )
}

function phaseForAction(value: string): 'inspect' | 'change' | 'verify' {
  if (/(?:test|verify|gate|lint|compile|typecheck)/.test(value)) return 'verify'
  if (/(?:edit|write|patch|diff|fix|implement)/.test(value)) return 'change'
  return 'inspect'
}

function workflowForGroup(
  name: string,
  category: string,
  sequence: string[],
): WorkflowSpec {
  const phases = [...new Set(sequence.map(phaseForAction))]
  if (!phases.includes('verify')) phases.push('verify')
  const steps: WorkflowStep[] = phases.map((phase, index) => ({
    id: phase,
    name: `${phase[0]!.toUpperCase()}${phase.slice(1)}`,
    agent: phase === 'verify' ? 'verification' : 'worker',
    prompt:
      phase === 'inspect'
        ? `Inspect the requested ${category} task and gather repository evidence. Do not modify files in this step.`
        : phase === 'change'
          ? `Implement the requested ${category} change using the inspection evidence. Keep edits scoped and reversible.`
          : 'Run the repository verification gates required by the task and report concrete evidence. End with VERDICT: PASS or VERDICT: FAIL.',
    dependsOn: index === 0 ? [] : [phases[index - 1]!],
    gate: phase === 'verify' ? 'verification' : undefined,
    checkpoint: true,
  }))
  return {
    version: 1,
    name,
    description:
      'Evidence-derived workflow candidate. Approval is required before use.',
    steps,
  }
}

/**
 * Learned workflows always enforce their verification gate. A failed verifier
 * re-opens the change step when present and can never be reported as complete.
 */
export function learnedWorkflowLoop(workflow: WorkflowSpec): ExecLoop {
  const verification = workflow.steps.find(
    step => step.gate === 'verification',
  )
  if (!verification) {
    throw new Error('Learned workflow is missing its verification gate')
  }
  const change = workflow.steps.find(step => step.id === 'change')
  return {
    from: verification.id,
    to: change?.id ?? verification.id,
    maxIterations: 2,
  }
}

/** 95% Wilson lower confidence bound. */
export function wilsonLowerBound(pass: number, total: number): number {
  if (total <= 0) return 0
  const z = 1.959963984540054
  const p = pass / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const margin =
    z *
    Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)
  return Math.max(0, (centre - margin) / denominator)
}

export type MineLearnedPlaybooksOptions = {
  runs?: MinedRun[]
  minSuccessfulRuns?: number
  minWilson?: number
  dryRun?: boolean
}

export type MineLearnedPlaybooksResult = {
  candidates: LearnedPlaybookCandidate[]
  skippedUnsafeRuns: string[]
}

export function mineLearnedPlaybooks(
  cwd: string,
  options: MineLearnedPlaybooksOptions = {},
): MineLearnedPlaybooksResult {
  const runs = options.runs ?? collectMinedRuns(cwd)
  const minSuccessfulRuns = Math.max(2, options.minSuccessfulRuns ?? 3)
  const minWilson = Math.max(0, Math.min(1, options.minWilson ?? 0.3))
  const skippedUnsafeRuns: string[] = []
  const grouped = new Map<string, MinedRun[]>()

  for (const run of runs) {
    const blocked = learnedRunSafety(run)
    if (blocked.length > 0) {
      skippedUnsafeRuns.push(run.runId)
      continue
    }
    const category = routeIntent(run.task).category || 'general'
    const sequence = actionSequence(run)
    if (sequence.length === 0) continue
    const fingerprint = digest({ category, sequence })
    const bucket = grouped.get(fingerprint) ?? []
    bucket.push(run)
    grouped.set(fingerprint, bucket)
  }

  const now = new Date().toISOString()
  const generated: LearnedPlaybookCandidate[] = []
  for (const [fingerprint, group] of grouped) {
    const successful = group.filter(run => run.passed)
    const lower = wilsonLowerBound(successful.length, group.length)
    if (successful.length < minSuccessfulRuns || lower < minWilson) continue
    const category = routeIntent(group[0]!.task).category || 'general'
    const name = slug(`${category}-${actionSequence(group[0]!)[0] ?? 'workflow'}`)
    const workflow = workflowForGroup(name, category, actionSequence(group[0]!))
    const evidence = successful
      .slice(-MAX_EVIDENCE_PER_CANDIDATE)
      .map(run => ({
        runId: run.runId,
        manifestDigest: run.manifestDigest,
        proofKinds: run.proofKinds,
        recordedAt: now,
      }))
    generated.push({
      version: 1,
      id: `lp-${createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)}`,
      name,
      status: 'candidate',
      revision: 1,
      match: {
        category,
        actionFingerprint: fingerprint,
        keywords: keywords(group.map(run => run.task).join(' ')),
      },
      workflow,
      evidence,
      metrics: {
        samples: group.length,
        pass: successful.length,
        fail: group.length - successful.length,
        wilsonLowerBound: lower,
      },
      safety: { requiresApproval: true, blockedReasons: [] },
      createdAt: now,
      updatedAt: now,
    })
  }

  if (!options.dryRun && generated.length > 0) {
    ensurePrivateDirectory(learningDir(cwd), learningDir(cwd))
    withPrivateStateLock(learningDir(cwd), 'playbooks', () => {
      const store = loadStore(cwd)
      for (const candidate of generated) {
        const index = store.candidates.findIndex(item => item.id === candidate.id)
        if (index === -1) {
          store.candidates.push(candidate)
          continue
        }
        const prior = store.candidates[index]!
        const evidenceByRun = new Map(
          [...prior.evidence, ...candidate.evidence].map(item => [
            `${item.runId}:${item.manifestDigest}`,
            item,
          ]),
        )
        const preserveApprovedDefinition =
          prior.status === 'approved' || prior.status === 'disabled'
        store.candidates[index] = {
          ...candidate,
          status: prior.status,
          ...(preserveApprovedDefinition
            ? { name: prior.name, workflow: prior.workflow }
            : {}),
          revision: prior.revision + 1,
          createdAt: prior.createdAt,
          evidence: [...evidenceByRun.values()].slice(-MAX_EVIDENCE_PER_CANDIDATE),
          updatedAt: now,
          ...(prior.rejectionReason
            ? { rejectionReason: prior.rejectionReason }
            : {}),
        }
      }
      saveStore(cwd, store)
    })
  }
  return { candidates: generated, skippedUnsafeRuns }
}

function mutateCandidate(
  cwd: string,
  id: string,
  update: (candidate: LearnedPlaybookCandidate) => void,
  options: { dryRun?: boolean } = {},
): LearnedPlaybookCandidate {
  ensurePrivateDirectory(learningDir(cwd), learningDir(cwd))
  return withPrivateStateLock(learningDir(cwd), 'playbooks', () => {
    const store = loadStore(cwd)
    const candidate = store.candidates.find(item => item.id === id || item.name === id)
    if (!candidate) throw new Error(`Learned playbook not found: ${id}`)
    update(candidate)
    candidate.updatedAt = new Date().toISOString()
    if (!options.dryRun) saveStore(cwd, store)
    return structuredClone(candidate)
  })
}

export function approveLearnedPlaybook(
  cwd: string,
  id: string,
  requestedName?: string,
  options: { dryRun?: boolean } = {},
): LearnedPlaybookCandidate {
  return mutateCandidate(cwd, id, candidate => {
    if (candidate.status === 'rejected' || candidate.status === 'disabled') {
      throw new Error('Rejected or disabled playbooks cannot be approved')
    }
    for (const evidence of candidate.evidence) {
      const manifest = readRunManifest(cwd, evidence.runId)
      const actions = readRunActions(cwd, evidence.runId)
      const proofs = proofKinds(actions)
      if (
        !manifest ||
        digest({ manifest, actions }) !== evidence.manifestDigest ||
        !runPassed(actions, proofs) ||
        learnedRunSafety({
          runId: evidence.runId,
          task: evidence.runId,
          actions,
          manifestDigest: evidence.manifestDigest,
          passed: true,
          proofKinds: proofs,
        }).length > 0
      ) {
        throw new Error(
          `Learned playbook evidence is missing, stale, failed, or unsafe: ${evidence.runId}`,
        )
      }
    }
    const name = slug(requestedName ?? candidate.name)
    const spec: WorkflowSpec = { ...candidate.workflow, name }
    const validation = validateWorkflow(spec)
    if (!validation.valid) {
      throw new Error(`Learned workflow is invalid: ${validation.errors.join('; ')}`)
    }
    const existing = loadWorkflow(cwd, name)
    if (candidate.status === 'approved') {
      if (
        name !== candidate.name ||
        !existing ||
        JSON.stringify(existing) !== JSON.stringify(candidate.workflow)
      ) {
        throw new Error('Approved workflow is missing, renamed, or changed')
      }
      return
    }
    if (existing) {
      throw new Error(
        `Workflow already exists and cannot be adopted by a learned playbook: ${name}`,
      )
    }
    if (!options.dryRun) {
      const saved = saveWorkflow(cwd, spec)
      if (!saved.created) throw new Error(`Workflow already exists: ${name}`)
    }
    candidate.name = name
    candidate.workflow = spec
    candidate.status = 'approved'
  }, options)
}

export function rejectLearnedPlaybook(
  cwd: string,
  id: string,
  reason: string,
  options: { dryRun?: boolean } = {},
): LearnedPlaybookCandidate {
  if (!reason.trim()) throw new Error('A rejection reason is required')
  return mutateCandidate(cwd, id, candidate => {
    if (candidate.status === 'approved' || candidate.status === 'disabled') {
      throw new Error('Promoted playbooks cannot be rejected; disable them instead')
    }
    candidate.status = 'rejected'
    candidate.rejectionReason = reason.trim().slice(0, 500)
  }, options)
}

export function disableLearnedPlaybook(
  cwd: string,
  id: string,
  options: { dryRun?: boolean } = {},
): LearnedPlaybookCandidate {
  return mutateCandidate(cwd, id, candidate => {
    if (candidate.status === 'disabled') return
    if (candidate.status !== 'approved') {
      throw new Error('Only approved playbooks can be disabled')
    }
    const promotedPath = workflowPath(cwd, candidate.name)
    const siblingPaths = [
      promotedPath,
      promotedPath.replace(/\.yaml$/u, '.yml'),
      promotedPath.replace(/\.yaml$/u, '.json'),
    ]
    const materialized = siblingPaths.filter(path => existsSync(path))
    if (materialized.some(path => path !== promotedPath)) {
      throw new Error(
        'Learned workflow has unexpected duplicate definitions; refusing to disable it',
      )
    }
    if (existsSync(promotedPath)) {
      const stat = lstatSync(promotedPath)
      const workflow = loadWorkflow(cwd, candidate.name)
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        !workflow ||
        JSON.stringify(workflow) !== JSON.stringify(candidate.workflow)
      ) {
        throw new Error(
          'Learned workflow changed after promotion; refusing to move it',
        )
      }
      const archiveDir = join(learningDir(cwd), 'disabled')
      const archivePath = join(
        archiveDir,
        `${candidate.id}-${digest(candidate.workflow).slice(7, 23)}.yaml.disabled`,
      )
      if (existsSync(archivePath)) {
        throw new Error('Disabled workflow archive already exists')
      }
      if (!options.dryRun) {
        ensurePrivateDirectory(learningDir(cwd), archiveDir)
        renameSync(promotedPath, archivePath)
        chmodSync(archivePath, 0o600)
      }
    }
    candidate.status = 'disabled'
  }, options)
}

export function recommendedLearnedPlaybooks(
  cwd: string,
  task: string,
  limit = 3,
): LearnedPlaybookCandidate[] {
  const category = routeIntent(task).category || 'general'
  const words = new Set(keywords(task))
  return listLearnedPlaybooks(cwd, 'approved')
    .filter(candidate => candidate.match.category === category)
    .map(candidate => ({
      candidate,
      overlap: candidate.match.keywords.filter(word => words.has(word)).length,
    }))
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        b.candidate.metrics.wilsonLowerBound -
          a.candidate.metrics.wilsonLowerBound,
    )
    .slice(0, Math.max(0, Math.min(10, limit)))
    .map(item => item.candidate)
}

/** Parse an approved workflow file again before execution (tamper check). */
export function loadApprovedLearnedWorkflow(
  cwd: string,
  id: string,
): WorkflowSpec {
  const candidate = getLearnedPlaybook(cwd, id)
  if (!candidate || candidate.status !== 'approved') {
    throw new Error('Learned playbook is not approved')
  }
  const workflow = loadWorkflow(cwd, candidate.name)
  if (!workflow) throw new Error(`Approved workflow is missing: ${candidate.name}`)
  if (!validateWorkflow(workflow).valid) {
    throw new Error('Approved workflow no longer validates')
  }
  if (JSON.stringify(workflow) !== JSON.stringify(candidate.workflow)) {
    throw new Error('Approved workflow changed after promotion')
  }
  return workflow
}
