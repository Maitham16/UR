/**
 * AgentKernel — a pure, testable orchestrator that separates an autonomous
 * software-engineering agent into seven roles:
 *
 *   planner    → decompose a goal into stages
 *   executor   → run a stage through a subagent and capture verdict
 *   verifier   → deterministic gates + adversarial evidence-based verification
 *   critic     → second-opinion review / oracle check
 *   memory     → load relevant memory snippets for a stage prompt
 *   router     → choose subagent type, model, and tool scope
 *   guard      → permission policy check (non-interactive)
 *
 * The kernel does NOT import the heavy subagent runtime (`runAgent.ts`) or React
 * permission hooks. It works with the injectable `HeadlessRunner` interface, so
 * callers (and tests) can supply a real `ur -p` subagent or a dry-run stub.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RouteResult } from './intentRouter.js'
import { routeIntent } from './intentRouter.js'
import type { ModelRouteResult } from './modelRouter.js'
import type { EscalationPlan } from './escalation.js'
import { consultOracle } from './escalation.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import { extractVerdict } from './cliStepRunner.js'
import type { Verdict } from './executor.js'
import { loadVerifyConfig, runGateCommands } from '../verifier/projectGates.js'
import type { SpecMeta, SpecTask } from './spec.js'
import { enforceNoPassWithoutProof } from './verificationProofs.js'
import { readTaskMemory } from '../context/projectContextManifest.js'
import {
  formatResolvedMemory,
  resolveTaskMemoryEntries,
} from '../context/memoryCitations.js'

export type KernelRole =
  | 'planner'
  | 'executor'
  | 'verifier'
  | 'critic'
  | 'memory'
  | 'router'
  | 'guard'

export type KernelContext = {
  cwd: string
  specName?: string
  task?: string
  goal?: string
  priorOutputs?: Record<string, string>
  memory?: string
  route?: RouteResult
  modelPlan?: EscalationPlan
  skipPermissions?: boolean
  stopOnError?: boolean
}

export type KernelArtifact =
  | { kind: 'file'; path: string }
  | { kind: 'record'; path: string; record: unknown }
  | { kind: 'note'; text: string }

export type KernelStage = {
  name: string
  role: KernelRole
  goal: string
  context: KernelContext
  instructions?: string
}

export type KernelResult = {
  stage: KernelStage
  verdict: Verdict | null
  output: string
  isError: boolean
  artifacts: KernelArtifact[]
  nextStages?: KernelStage[]
}

export type KernelEvent =
  | { kind: 'stage-start'; stage: string; role: KernelRole }
  | { kind: 'stage-done'; stage: string; verdict: Verdict | null; isError: boolean }
  | { kind: 'gate'; stage: string; command: string; ok: boolean }
  | { kind: 'artifact'; stage: string; artifact: KernelArtifact }

export type PermissionGuard = {
  /** Non-interactive check. `ask` is treated as deny unless skipPermissions is true. */
  canUseTool(toolName: string, input: unknown): { allowed: boolean; reason?: string }
}

export type ToolRouter = {
  routeTask(task: string): RouteResult
  recommendModel(task: string, models: unknown[]): ModelRouteResult | null
}

export type MemoryManager = {
  loadMemorySnippet(scope: 'project' | 'user' | 'local', agentType: string): string | null
}

export type Planner = {
  planStages(context: KernelContext): KernelStage[]
}

export type StageExecutor = {
  execute(stage: KernelStage, options: { runner?: HeadlessRunner; maxTurns?: number; skipPermissions?: boolean }): Promise<KernelResult>
}

export type Verifier = {
  verify(stage: KernelStage, options: { runner?: HeadlessRunner; maxTurns?: number; skipPermissions?: boolean }): Promise<KernelResult>
}

export type Critic = {
  review(stage: KernelStage, previousOutput: string, options: { runner?: HeadlessRunner; maxTurns?: number }): Promise<KernelResult>
}

export type AgentKernel = {
  guard: PermissionGuard
  router: ToolRouter
  memory: MemoryManager
  planner: Planner
  executor: StageExecutor
  verifier: Verifier
  critic: Critic
}

export type KernelOptions = {
  cwd: string
  dryRun?: boolean
  maxTurns?: number
  skipPermissions?: boolean
  runner?: HeadlessRunner
  onEvent?: (event: KernelEvent) => void
}

function defaultGuard(skipPermissions?: boolean): PermissionGuard {
  return {
    canUseTool: (_toolName, _input) => ({
      allowed: skipPermissions === true,
      reason: skipPermissions ? 'permissions skipped' : 'interactive ask treated as deny in kernel',
    }),
  }
}

function defaultRouter(): ToolRouter {
  return {
    routeTask: task => routeIntent(task),
    recommendModel: () => null,
  }
}

function defaultMemory(cwd: string): MemoryManager {
  return {
    loadMemorySnippet: (scope, agentType) => {
      const base = scope === 'project' ? join(cwd, '.ur', 'memory') : join(cwd, '.ur', 'memory')
      const path = join(base, `${agentType}.md`)
      const legacy = existsSync(path) ? readFileSync(path, 'utf-8') : ''
      if (scope !== 'project') return legacy || null
      try {
        const cited = resolveTaskMemoryEntries(cwd, readTaskMemory(cwd), {
          maxEntries: 8,
        })
        const shared =
          cited.length > 0 ? formatResolvedMemory(cited, 8 * 1024).trim() : ''
        return [legacy.trim(), shared].filter(Boolean).join('\n\n') || null
      } catch {
        // An invalid shared-memory chain is fail-closed and never enters prompts.
        return legacy || null
      }
    },
  }
}

function defaultExecutor(): StageExecutor {
  return {
    execute: async (stage, options) => {
      const runner = options.runner ?? defaultHeadlessRunner()
      const out = await runner({
        cwd: stage.context.cwd,
        prompt: stage.instructions ?? stage.goal,
        maxTurns: options.maxTurns,
        skipPermissions: options.skipPermissions,
      })
      return {
        stage,
        verdict: out.verdict ?? extractVerdict(out.output),
        output: out.output,
        isError: out.isError ?? false,
        artifacts: [],
      }
    },
  }
}

function defaultVerifier(): Verifier {
  return {
    verify: async (stage, options) => {
      const config = await loadVerifyConfig(stage.context.cwd)
      const gateResults: KernelResult['artifacts'] = []
      const emitGate = (command: string, ok: boolean) => {
        gateResults.push({ kind: 'note', text: `${ok ? 'PASS' : 'FAIL'} gate: ${command}` })
      }

      if (config?.afterEdit && config.afterEdit.length > 0) {
        const gate = await runGateCommands(config.afterEdit, stage.context.cwd, config.timeoutMs)
        if (!gate.ok) {
          const failed = gate as Extract<typeof gate, { ok: false }>
          emitGate(failed.command, false)
          return {
            stage,
            verdict: 'FAIL',
            output: failed.reminder,
            isError: true,
            artifacts: gateResults,
          }
        }
        for (const cmd of config.afterEdit) emitGate(cmd, true)
      }

      const runner = options.runner ?? defaultHeadlessRunner()
      const out = await runner({
        cwd: stage.context.cwd,
        prompt: stage.instructions ?? stage.goal,
        maxTurns: options.maxTurns,
        skipPermissions: options.skipPermissions,
      })
      const initialVerdict = out.verdict ?? extractVerdict(out.output) ?? 'PARTIAL'
      const strict = enforceNoPassWithoutProof(initialVerdict, out.output)
      if (strict.proofFailure) {
        gateResults.push({
          kind: 'note',
          text: `FAIL proof: missing ${strict.proofCheck.missing.join(', ')}`,
        })
      }
      return {
        stage,
        verdict: strict.verdict,
        output: strict.output,
        isError: (out.isError ?? false) || strict.proofFailure,
        artifacts: gateResults,
      }
    },
  }
}

function defaultCritic(): Critic {
  return {
    review: async (stage, previousOutput, options) => {
      const runner = options.runner ?? defaultHeadlessRunner()
      const prompt = [
        'You are a critic reviewing another agent\'s work.',
        'Original task:',
        stage.goal,
        '',
        'Agent output:',
        previousOutput.slice(0, 4000),
        '',
        'Identify gaps, risks, or better approaches. End with VERDICT: PASS if satisfactory, VERDICT: FAIL if material issues remain, or VERDICT: PARTIAL if limited by environment.',
      ].join('\n')
      const out = await runner({ cwd: stage.context.cwd, prompt, maxTurns: options.maxTurns })
      return {
        stage: { ...stage, name: `${stage.name}:critic`, role: 'critic' },
        verdict: out.verdict ?? extractVerdict(out.output),
        output: out.output,
        isError: out.isError ?? false,
        artifacts: [],
      }
    },
  }
}

export function createAgentKernel(options: KernelOptions): AgentKernel {
  return {
    guard: defaultGuard(options.skipPermissions),
    router: defaultRouter(),
    memory: defaultMemory(options.cwd),
    planner: { planStages: () => [] },
    executor: defaultExecutor(),
    verifier: defaultVerifier(),
    critic: defaultCritic(),
  }
}

export async function runKernelStage(
  kernel: AgentKernel,
  stage: KernelStage,
  options: KernelOptions,
): Promise<KernelResult> {
  options.onEvent?.({ kind: 'stage-start', stage: stage.name, role: stage.role })

  const runner = options.runner ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
  const runOptions = {
    runner,
    maxTurns: options.maxTurns,
    skipPermissions: options.skipPermissions,
  }

  let result: KernelResult
  switch (stage.role) {
    case 'executor':
      result = await kernel.executor.execute(stage, runOptions)
      break
    case 'verifier':
      result = await kernel.verifier.verify(stage, runOptions)
      break
    case 'critic':
      result = await kernel.critic.review(stage, stage.context.priorOutputs?.previous ?? '', runOptions)
      break
    case 'planner':
      result = {
        stage,
        verdict: null,
        output: 'Planner role: stage list produced.',
        isError: false,
        artifacts: [],
        nextStages: kernel.planner.planStages(stage.context),
      }
      break
    case 'memory': {
      const snippet = kernel.memory.loadMemorySnippet('project', stage.name)
      result = {
        stage,
        verdict: null,
        output: snippet ?? '(no memory snippet)',
        isError: false,
        artifacts: snippet ? [{ kind: 'note', text: snippet }] : [],
      }
      break
    }
    case 'router': {
      const route = kernel.router.routeTask(stage.goal)
      result = {
        stage,
        verdict: null,
        output: `Routed to ${route.agent} (${route.category}) with pattern ${route.pattern ?? 'single'}.`,
        isError: false,
        artifacts: [{ kind: 'note', text: JSON.stringify(route) }],
      }
      break
    }
    case 'guard': {
      const check = kernel.guard.canUseTool(stage.name, stage.goal)
      result = {
        stage,
        verdict: check.allowed ? 'PASS' : 'FAIL',
        output: check.reason ?? (check.allowed ? 'allowed' : 'denied'),
        isError: !check.allowed,
        artifacts: [],
      }
      break
    }
    default:
      result = {
        stage,
        verdict: 'PARTIAL',
        output: `Unsupported kernel role: ${stage.role}`,
        isError: true,
        artifacts: [],
      }
  }

  options.onEvent?.({ kind: 'stage-done', stage: stage.name, verdict: result.verdict, isError: result.isError })
  for (const artifact of result.artifacts) {
    options.onEvent?.({ kind: 'artifact', stage: stage.name, artifact })
  }

  return result
}
