import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { compileStepPrompt } from './cliStepRunner.js'
import { isProcessAlive, makeProcessOwner, ownerMayBeAlive } from './durableState.js'
import { defaultHeadlessRunner, type HeadlessRunOptions, type HeadlessRunOutput, type HeadlessRunner } from './headlessAgent.js'
import { loadGoal, mutateGoal, validateGoalBudget, type GoalBudget, type GoalInFlight, type GoalOutcome, type GoalSpec } from './goals.js'
import { runExecutionBoundVerification } from './runVerification.js'
import { runWorkflowSpec } from './runWorkflow.js'
import { loadWorkflow } from './workflows.js'
import { getEmptyToolPermissionContext, type ToolPermissionContext } from '../../Tool.js'
import { matchingRuleForInput } from '../../utils/permissions/filesystem.js'
import { applyPermissionRulesToPermissionContext, getDenyRules, getAskRules, getParameterRuleForToolInput } from '../../utils/permissions/permissions.js'
import { loadAllPermissionRulesFromDisk } from '../../utils/permissions/permissionsLoader.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { captureVerificationState } from '../verifier/executionEvidence.js'

export type GoalUpdate = { action: 'continue' | 'workflow' | 'verify' | 'blocked'; summary: string; nextPrompt?: string; blockers?: string[]; workflow?: string }
export type RunGoalOptions = {
  cwd: string; runner?: HeadlessRunner; budget?: GoalBudget; dryRun?: boolean
  model?: string; skipPermissions?: boolean; signal?: AbortSignal
}

function taggedJson(text: string, tag: string): unknown {
  const matches = [...text.matchAll(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'g'))]
  if (!matches.length) throw new Error(`Missing <${tag}> structured result; no completion is inferred.`)
  return JSON.parse(matches.at(-1)![1])
}
export function parseGoalUpdate(text: string): GoalUpdate {
  const value = taggedJson(text, 'ur-goal-update') as GoalUpdate
  if (!value || !['continue', 'workflow', 'verify', 'blocked'].includes(value.action) || typeof value.summary !== 'string' || !value.summary.trim() ||
      (value.nextPrompt !== undefined && typeof value.nextPrompt !== 'string') ||
      (value.blockers !== undefined && (!Array.isArray(value.blockers) || value.blockers.some(item => typeof item !== 'string'))) ||
      (value.action === 'workflow' && (typeof value.workflow !== 'string' || !value.workflow.trim()))) throw new Error('Invalid goal update; no completion is inferred.')
  return value
}
function hashProgress(output: string, state: string): string { return createHash('sha256').update(JSON.stringify([output.trim().replace(/\s+/gu, ' '), state])).digest('hex') }
function digest(goal: GoalSpec): string {
  return createHash('sha256').update(JSON.stringify({ objective: goal.objective, criteria: goal.criteria, workflow: goal.workflow, pattern: goal.pattern })).digest('hex')
}
export function goalBudgetBlocker(goal: GoalSpec): string | null {
  const { budget, usage } = goal.controller!
  if (budget.maxCalls !== undefined && usage.calls >= budget.maxCalls) return `Aggregate call budget exhausted (${usage.calls}/${budget.maxCalls}).`
  if (budget.maxTurns !== undefined && usage.turns >= budget.maxTurns) return `Aggregate turn budget exhausted (${usage.turns}/${budget.maxTurns}).`
  if (budget.maxDurationMs !== undefined && usage.elapsedMs >= budget.maxDurationMs) return `Aggregate active time budget exhausted (${usage.elapsedMs}/${budget.maxDurationMs} ms).`
  if (budget.maxCostUsd !== undefined && usage.costUsd >= budget.maxCostUsd) return `Aggregate cost budget exhausted ($${usage.costUsd}/$${budget.maxCostUsd}).`
  if (budget.maxCostUsd !== undefined && usage.unknownCostCalls) return 'A prior call has unknown cost; the remaining monetary budget cannot be established. Inspect the provider usage before changing the budget.'
  if (budget.maxTurns !== undefined && usage.unknownTurnCalls) return 'A prior call has unknown turn usage; the remaining turn budget cannot be established.'
  return null
}

/** Criterion evidence may be real command receipts or current file observations.
 * The model chooses checks; this validates provenance/current state, not semantic truth.
 */
export async function assessGoalOutcome(goal: GoalSpec, cwd: string, output: string,
  evidence: Awaited<ReturnType<typeof runExecutionBoundVerification>>['evidence'], runnerError: boolean, permissionContext?: ToolPermissionContext,
): Promise<GoalOutcome> {
  const at = new Date().toISOString()
  let report: { summary?: string; criteria?: Array<{ id: string; passed: boolean; reason: string; executions?: string[]; artifacts?: Array<{ path: string; excerpt: string }> }> }
  try { report = taggedJson(output, 'ur-goal-verification') as typeof report } catch (error) {
    return { status: 'unverified', at, summary: String(error) }
  }
  if (!report || typeof report !== 'object' || !Array.isArray(report.criteria)) return { status: 'unverified', at, summary: 'Invalid criterion verification result.' }
  const reported = report.criteria.filter(item => item && typeof item === 'object')
  const root = realpathSync(cwd)
  const observed = await captureVerificationState(cwd).catch(() => undefined)
  const permissions = permissionContext ?? runWithCwdOverride(root, () => applyPermissionRulesToPermissionContext(getEmptyToolPermissionContext(), loadAllPermissionRulesFromDisk()))
  const globallyValid = !runnerError && !evidence.observationError && !!evidence.stateSha256 && evidence.cwd === root
  const assessments = (goal.criteria ?? []).map(criterion => {
    const entries = reported.filter(item => item.id === criterion.id)
    const entry = entries.length === 1 ? entries[0] : undefined
    const executionIds = [...new Set((Array.isArray(entry?.executions) ? entry.executions : []).filter(id => typeof id === 'string').map(id => id.replace(/^execution:/u, '')))].filter(id => {
      const matches = evidence.executions.filter(item => item.id === id)
      const item = matches.length === 1 ? matches[0] : undefined
      return globallyValid && item && item.runId === evidence.runId && item.cwd === root && item.exitCode === 0 && !item.interrupted && !item.observationError &&
        item.beforeStateSha256 === evidence.stateSha256 && item.afterStateSha256 === evidence.stateSha256 &&
        Number.isFinite(Date.parse(item.startedAt)) && Number.isFinite(Date.parse(item.finishedAt)) && Date.parse(item.finishedAt) >= Date.parse(item.startedAt)
    })
    const artifacts: NonNullable<GoalOutcome['criteria']>[number]['artifacts'] = []
    if (globallyValid) for (const artifact of Array.isArray(entry?.artifacts) ? entry.artifacts : []) {
      try {
        if (typeof artifact.path !== 'string' || typeof artifact.excerpt !== 'string' || artifact.excerpt.length < 1 || artifact.excerpt.length > 4000) continue
        const path = realpathSync(resolve(root, artifact.path)), rel = relative(root, path)
        const parts = rel.split(/[\\/]/u), base = parts.at(-1) ?? ''
        if (parts.some(part => ['.git', '.ur', '.aws', '.ssh', '.codex', '.agents', '.npm', '.config'].includes(part)) || /^\.env(?:\.|$)/iu.test(base) || /(?:^|[-_.])(?:credentials?|secrets?)(?:[-_.]|$)/iu.test(base) || /\.(?:key|pem|p12|pfx|keystore)$/iu.test(base)) continue
        if (!observed || !Object.hasOwn(observed.files, relative(observed.root, path))) continue
        const restricted = runWithCwdOverride(root, () =>
          [...getDenyRules(permissions), ...getAskRules(permissions)].find(rule => rule.ruleValue.toolName === 'Read' && rule.ruleValue.ruleContent === undefined && !rule.ruleValue.ruleParameter) ||
          getParameterRuleForToolInput(permissions, { name: 'Read' }, { file_path: path }, 'deny') || getParameterRuleForToolInput(permissions, { name: 'Read' }, { file_path: path }, 'ask') ||
          matchingRuleForInput(path, permissions, 'read', 'deny') || matchingRuleForInput(path, permissions, 'read', 'ask'))
        if (restricted) continue
        if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !statSync(path).isFile() || statSync(path).size > 1024 * 1024) continue
        const bytes = readFileSync(path), text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (!text.includes(artifact.excerpt)) continue
        artifacts.push({ path: rel, sha256: createHash('sha256').update(bytes).digest('hex'), excerpt: artifact.excerpt })
      } catch { /* An unavailable or changed observation cannot support completion. */ }
    }
    return { id: criterion.id, passed: globallyValid && entry?.passed === true && typeof entry.reason === 'string' && entry.reason.trim().length > 0 && (executionIds.length > 0 || artifacts.length > 0),
      reason: entry?.reason || 'No unique criterion assessment with current evidence was recorded.', executionIds, artifacts }
  })
  let current = false
  try { current = (await captureVerificationState(cwd)).sha256 === evidence.stateSha256 } catch { /* Current-state evidence could not be established. */ }
  if (!current) for (const assessment of assessments) { assessment.passed = false; assessment.reason = 'Source state changed or could not be observed after verification.' }
  return { status: assessments.length > 0 && assessments.every(item => item.passed) ? 'verified' : 'unverified', at,
    summary: report.summary || evidence.observationError || 'Criterion-specific outcome assessment.', stateSha256: evidence.stateSha256, criteria: assessments }
}

function controllerPrompt(goal: GoalSpec): string {
  return [
    `Advance this persistent goal using your own strategy, tools, delegation and replanning. Objective: ${goal.objective}`,
    `Outcome criteria (workflow completion alone is not completion): ${JSON.stringify(goal.criteria)}`,
    `Linked workflow, available if useful: ${goal.workflow ?? 'none'}. Pattern hint: ${goal.pattern ?? 'none'}.`,
    `Aggregate budget/usage: ${JSON.stringify({ budget: goal.controller!.budget, usage: goal.controller!.usage })}`,
    `Progress: ${JSON.stringify(goal.controller!.history.slice(-8))}`,
    `Blockers: ${JSON.stringify(goal.controller!.blockers)}`,
    goal.controller!.nextPrompt ?? '',
    'Do useful work directly, request the linked/another saved workflow, ask for outcome verification, or report a concrete blocker. Do not recursively launch goal/workflow/crew commands to evade controller accounting; request action "workflow" when appropriate. Existing user permissions apply.',
    'End with <ur-goal-update>{"action":"continue|workflow|verify|blocked","summary":"actual progress","nextPrompt":"remaining work or replanning feedback","blockers":[],"workflow":"only for action workflow"}</ur-goal-update>. Use verify when you believe the criteria are met; a separate assessment checks that claim. Never infer success from a workflow status.',
  ].filter(Boolean).join('\n\n')
}

export async function runGoalController(name: string, options: RunGoalOptions): Promise<GoalSpec> {
  const initial = loadGoal(options.cwd, name)
  if (!initial) throw new Error(`Goal not found: ${name}`)
  validateGoalBudget(options.budget ?? {})
  if (options.dryRun) return initial // Preview never spends budget or marks a goal done.
  if (initial.status === 'done' || initial.status === 'abandoned') return initial
  const owner = makeProcessOwner()
  mutateGoal(options.cwd, name, goal => {
    const controller = goal.controller!
    if (ownerMayBeAlive(controller.owner)) throw new Error('Goal already has a live controller.')
    if (controller.inFlight?.requiresProcessIdentity && !controller.inFlight.pid && !controller.inFlight.accounted) throw new Error('The interrupted goal launch has no durable process identity; inspect running processes before reconciling the saved goal state.')
    if (controller.inFlight?.pid && isProcessAlive(controller.inFlight.pid)) throw new Error('A goal agent is still running after its controller exited; refusing a duplicate agent.')
    if (controller.digest && controller.digest !== digest(goal)) throw new Error('Goal objective/criteria/strategy changed while state was persisted. Review prior work and create an explicitly new goal instead of reusing its effects.')
    if (controller.inFlight && !controller.inFlight.accounted) {
      controller.usage.unknownCostCalls++; controller.usage.unknownTurnCalls++
      controller.inFlight.accounted = true
      controller.nextPrompt = `The prior controller was interrupted; its tool effects and incomplete usage are UNKNOWN. Inspect saved work and choose how to reconcile, without blindly repeating commands.\n${controller.nextPrompt ?? ''}`
    }
    controller.budget = { ...controller.budget, ...options.budget }
    controller.owner = owner; controller.digest = digest(goal); controller.state = 'running'
    goal.status = 'active'
  })
  const runner = options.runner ?? defaultHeadlessRunner()
  const abort = new AbortController()
  const externalAbort = () => abort.abort()
  options.signal?.addEventListener('abort', externalAbort, { once: true })
  if (options.signal?.aborted) abort.abort()
  let lastTick = Date.now()
  const change = <T>(operation: (goal: GoalSpec) => T): T => {
    const result = mutateGoal(options.cwd, name, goal => {
      if (goal.controller!.owner?.token !== owner.token) throw new Error('Goal controller ownership changed.')
      const at = Date.now(); goal.controller!.usage.elapsedMs += Math.max(0, at - lastTick); lastTick = at
      goal.controller!.owner.heartbeatAt = new Date(at).toISOString()
      return operation(goal)
    })
    if (result === null) throw new Error('Goal was deleted during execution.')
    return result
  }
  const heartbeat = setInterval(() => {
    try {
      change(goal => {
        if (goal.status !== 'active' || goalBudgetBlocker(goal)) abort.abort()
      })
    } catch { abort.abort() }
  }, 250)
  heartbeat.unref()

  const invoke = async (kind: GoalInFlight['kind'], prompt: string, saved?: GoalInFlight, extra?: Partial<GoalInFlight>, verification?: HeadlessRunOptions['verification']): Promise<HeadlessRunOutput> => {
    let request!: HeadlessRunOptions
    change(goal => {
      const blocker = goalBudgetBlocker(goal)
      if (blocker || goal.status !== 'active' || abort.signal.aborted) throw new Error(blocker ?? 'Goal was paused/canceled.')
      const controller = goal.controller!, id = saved?.sessionId ?? randomUUID()
      controller.usage.calls++
      controller.inFlight = { kind, sessionId: id, startedAt: new Date().toISOString(), prompt, requiresProcessIdentity: !options.runner, ...extra }
      const budget = controller.budget, usage = controller.usage
      request = { cwd: options.cwd, prompt, verification, model: options.model, skipPermissions: options.skipPermissions,
        ...(saved?.sessionId ? { resumeSessionId: id } : { sessionId: id }), signal: abort.signal,
        ...(budget.maxTurns !== undefined ? { maxTurns: Math.max(1, budget.maxTurns - usage.turns) } : {}),
        ...(budget.maxCostUsd !== undefined ? { maxBudgetUsd: budget.maxCostUsd - usage.costUsd } : {}),
        ...(budget.maxDurationMs !== undefined ? { timeoutMs: Math.max(1, budget.maxDurationMs - usage.elapsedMs) } : {}),
        onSpawn: pid => { change(goal => { goal.controller!.inFlight!.pid = pid }) },
      }
    })
    const account = (out: HeadlessRunOutput): void => { change(goal => {
      const controller = goal.controller!
      if (typeof out.costUsd !== 'number' || !Number.isFinite(out.costUsd) || out.costUsd < 0) controller.usage.unknownCostCalls++; else controller.usage.costUsd += out.costUsd
      if (typeof out.turns !== 'number' || !Number.isSafeInteger(out.turns) || out.turns < 0) controller.usage.unknownTurnCalls++; else controller.usage.turns += out.turns
      controller.inFlight!.accounted = true
      controller.history.push({ at: new Date().toISOString(), kind, summary: out.output, sessionId: out.sessionId ?? request.sessionId ?? request.resumeSessionId, costUsd: out.costUsd, turns: out.turns })
      if (!abort.signal.aborted) delete controller.inFlight
    }) }
    try {
      const out = await runner(request)
      account(out); return out
    } catch (error) {
      const out = { output: `Agent interrupted or failed: ${String(error)}`, isError: true }
      account(out); return out
    }
  }

  try {
    let pending = initial.controller?.inFlight
    while (!abort.signal.aborted) {
      const goal = change(goal => goal)
      const blocker = goalBudgetBlocker(goal)
      if (blocker) { change(goal => { goal.controller!.state = 'budget-exhausted'; goal.controller!.blockers = [blocker] }); break }
      if (goal.status !== 'active') break
      if (pending?.kind === 'workflow' && pending.workflow) {
        // The workflow executor restores completed outputs and exposes unknown outcomes.
        const workflow = loadWorkflow(options.cwd, pending.workflow)
        if (!workflow) throw new Error(`Saved goal workflow is missing: ${pending.workflow}`)
        const stateName = pending.stateName!
        const result = await runWorkflowSpec(workflow, { cwd: options.cwd, stateName, resume: true, maxConcurrency: 1,
          runStep: input => invoke('workflow', compileStepPrompt(input), pending?.stepId === input.step.id ? pending : undefined,
            { workflow: workflow.name, stateName, stepId: input.step.id }),
        })
        pending = undefined
        change(goal => { goal.controller!.nextPrompt = `Workflow ${workflow.name} ended ${result.status}; inspect its results and replan against the goal criteria. Completion is not outcome verification.\n${JSON.stringify(result)}` })
        continue
      }
      let update: GoalUpdate
      if (pending?.kind === 'verification') update = { action: 'verify', summary: 'Resume interrupted criterion verification.' }
      else {
        const out = await invoke('agent', controllerPrompt(goal), pending?.kind === 'agent' ? pending : undefined)
        pending = undefined
        if (abort.signal.aborted) break
        const source = await captureVerificationState(options.cwd).catch(() => undefined)
        if (source) {
          const progress = hashProgress(out.output, source.sha256)
          const stalled = change(goal => {
            const controller = goal.controller!
            controller.noProgressRepeats = controller.lastProgressDigest === progress ? (controller.noProgressRepeats ?? 0) + 1 : 0
            controller.lastProgressDigest = progress
            if (controller.noProgressRepeats >= 2) {
              controller.state = 'blocked'
              controller.blockers = ['Two repeated agent responses produced no new visible progress against the same observed source state. Inspect the loop and resume with new information or a changed strategy.']
              return true
            }
            return false
          })
          if (stalled) break
        }
        if (out.isError) { change(goal => { goal.controller!.nextPrompt = `The previous agent failed; inspect partial work and replan.\n${out.output}` }); continue }
        try { update = parseGoalUpdate(out.output) } catch (error) {
          change(goal => { goal.controller!.nextPrompt = `${String(error)}\nReview your prior progress and finish with the required structured update.\n${out.output}` }); continue
        }
      }
      change(goal => { goal.notes.push({ at: new Date().toISOString(), text: update.summary }); goal.controller!.nextPrompt = update.nextPrompt })
      if (update.action === 'blocked') {
        change(goal => { goal.controller!.state = 'blocked'; goal.controller!.blockers = update.blockers?.length ? update.blockers : [update.summary] }); break
      }
      if (update.action === 'workflow') {
        const workflow = loadWorkflow(options.cwd, update.workflow!)
        if (!workflow) { change(goal => { goal.controller!.nextPrompt = `Requested workflow not found: ${update.workflow}. Choose another strategy.` }); continue }
        pending = { kind: 'workflow', workflow: workflow.name, stateName: `goal-${createHash('sha256').update(goal.name).digest('hex').slice(0, 12)}-${goal.controller!.usage.calls}`, accounted: true, startedAt: new Date().toISOString() }
        change(goal => { goal.controller!.inFlight = pending })
        continue
      }
      if (update.action === 'verify') {
        const verificationPrompt = `Independently assess this goal without changing the deliverable. Objective: ${goal.objective}\nCriteria: ${JSON.stringify(goal.criteria)}\nChoose checks and observations appropriate to these criteria; do not assume workflow success proves them.\nEnd with <ur-goal-verification>{"summary":"assessment","criteria":[{"id":"c1","passed":true,"reason":"why the evidence supports this criterion","executions":["actual-tool-use-id"],"artifacts":[{"path":"relative/current/file","excerpt":"exact supporting content"}]}]}</ur-goal-verification>. Each passed criterion must cite an actual successful current-state command execution ID or current file excerpt. Unsupported/failed criteria must say passed:false.`
        const checked = await runExecutionBoundVerification(
          request => invoke('verification', request.prompt, pending?.kind === 'verification' ? pending : undefined, undefined, request.verification),
          { cwd: options.cwd, prompt: verificationPrompt },
        )
        pending = undefined
        const outcome = await assessGoalOutcome(loadGoal(options.cwd, name)!, options.cwd, checked.out.output, checked.evidence, checked.out.isError === true)
        change(goal => { goal.outcome = outcome; goal.controller!.nextPrompt = `Outcome remains ${outcome.status}. Replan using this feedback:\n${JSON.stringify(outcome)}`
          if (outcome.status === 'verified') { goal.status = 'done'; goal.controller!.state = 'completed'; goal.controller!.blockers = [] }
        })
        if (outcome.status === 'verified') break
      }
    }
    if (abort.signal.aborted) change(goal => {
      const blocker = goalBudgetBlocker(goal)
      goal.controller!.state = blocker ? 'budget-exhausted' : 'interrupted'
      goal.controller!.blockers = [blocker ?? (goal.status === 'paused' ? 'Paused by the user.' : 'Controller interrupted; inspect and resume saved work.')]
    })
  } catch (error) {
    change(goal => { goal.controller!.state = goalBudgetBlocker(goal) ? 'budget-exhausted' : 'blocked'; goal.controller!.blockers = [String(error)] })
  } finally {
    clearInterval(heartbeat); options.signal?.removeEventListener('abort', externalAbort)
    change(goal => { delete goal.controller!.owner })
  }
  return loadGoal(options.cwd, name)!

}
