import { formatExecResult } from '../../services/agents/executor.js'
import {
  LiveExecutionBoard,
  formatLiveEvent,
} from '../../services/agents/liveBoard.js'
import { runWorkflowSpec } from '../../services/agents/runWorkflow.js'
import {
  approveWorkflowStep,
  type WorkflowSpec,
  buildRunPlan,
  formatRunPlan,
  formatValidation,
  listWorkflows,
  loadRunState,
  loadWorkflow,
  markRunCheckpoint,
  markRunStatus,
  normalizeWorkflowCompleted,
  renderWorkflowAscii,
  renderWorkflowMermaid,
  resetRunState,
  saveWorkflow,
  setRunCompleted,
  validateWorkflow,
} from '../../services/agents/workflows.js'
import type {
  LocalCommandCall,
  LocalCommandResult,
} from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

const WORKFLOW_VALUE_OPTIONS = new Set(['--max-turns', '--concurrency'])
const WORKFLOW_FLAGS = new Set([
  '--ascii',
  '--force',
  '--dry-run',
  '--resume',
  '--live',
  '--skip-permissions',
  '--dangerously-skip-permissions',
  '--json',
])

function parseWorkflowTokens(tokens: string[]): {
  positional: string[]
  flags: Set<string>
  values: Map<string, string>
} {
  const positional: string[] = []
  const flags = new Set<string>()
  const values = new Map<string, string>()
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const equals = token.indexOf('=')
    const name = equals > 2 ? token.slice(0, equals) : token
    if (WORKFLOW_VALUE_OPTIONS.has(name)) {
      const value = equals > 2 ? token.slice(equals + 1) : tokens[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${name} requires a value`)
      }
      values.set(name, value)
      if (equals < 0) index++
      continue
    }
    if (!WORKFLOW_FLAGS.has(name) || equals > 2) {
      throw new Error(`Unknown workflow option: ${token}`)
    }
    flags.add(name)
  }
  return { positional, flags, values }
}

function sampleWorkflow(name: string): WorkflowSpec {
  return {
    version: 1,
    name: name || 'example',
    description: 'Example checkpointed agent workflow. Edit the steps freely.',
    steps: [
      {
        id: 'research',
        name: 'Research',
        agent: 'docs-researcher',
        prompt: 'Research the problem and gather primary sources.',
        dependsOn: [],
        checkpoint: true,
      },
      {
        id: 'implement',
        name: 'Implement',
        agent: 'worker',
        prompt: 'Implement the change based on the research, verifying as you go.',
        dependsOn: ['research'],
        checkpoint: true,
      },
      {
        id: 'verify',
        name: 'Verify',
        agent: 'verification',
        prompt: 'Verify the change end to end. End with VERDICT: PASS or VERDICT: FAIL.',
        dependsOn: ['implement'],
        gate: 'verification',
      },
    ],
  }
}

function notFound(
  name: string,
  setFailure: (code?: number) => void,
): { type: 'text'; value: string } {
  setFailure()
  const available = listWorkflows(getCwd())
  const hint = available.length > 0 ? `\nAvailable: ${available.join(', ')}` : ''
  return {
    type: 'text',
    value: `Workflow not found: ${name}${hint}\nCreate one: ur workflow init ${name}`,
  }
}

async function callWorkflow(
  args: string,
  setFailure: (code?: number) => void,
): Promise<LocalCommandResult> {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  let parsed: ReturnType<typeof parseWorkflowTokens>
  try {
    parsed = parseWorkflowTokens(tokens)
  } catch (error) {
    setFailure(2)
    return {
      type: 'text',
      value: error instanceof Error ? error.message : String(error),
    }
  }
  const { positional, flags, values } = parsed
  const json = flags.has('--json')
  const ascii = flags.has('--ascii')
  const force = flags.has('--force')
  const command = positional[0] ?? 'list'
  const name = positional[1]

  if (command === 'list') {
    const names = listWorkflows(cwd)
    if (json) return { type: 'text', value: JSON.stringify({ workflows: names }, null, 2) }
    if (names.length === 0) {
      return { type: 'text', value: 'No workflows yet. Create one: ur workflow init' }
    }
    return { type: 'text', value: `Workflows:\n${names.map(n => `  - ${n}`).join('\n')}` }
  }

  if (command === 'init') {
    const spec = sampleWorkflow(name ?? 'example')
    const result = saveWorkflow(cwd, spec, { force })
    if (!result.created) setFailure()
    return {
      type: 'text',
      value: result.created
        ? `Created workflow ${spec.name} at ${result.path}`
        : `Workflow already exists at ${result.path} (use --force to overwrite)`,
    }
  }

  if (!name) {
    setFailure(2)
    return { type: 'text', value: `Usage: ur workflow ${command} <name>` }
  }
  const spec = loadWorkflow(cwd, name)
  if (!spec) return notFound(name, setFailure)

  if (command === 'validate') {
    const validation = validateWorkflow(spec)
    if (!validation.valid) setFailure()
    if (json) return { type: 'text', value: JSON.stringify(validation, null, 2) }
    return { type: 'text', value: formatValidation(spec, validation) }
  }

  if (command === 'graph') {
    const validation = validateWorkflow(spec)
    if (!validation.valid) setFailure()
    const value = ascii ? renderWorkflowAscii(spec) : renderWorkflowMermaid(spec)
    return { type: 'text', value }
  }

  if (command === 'show') {
    const validation = validateWorkflow(spec)
    if (!validation.valid) setFailure()
    if (json) {
      return {
        type: 'text',
        value: JSON.stringify({ spec, validation }, null, 2),
      }
    }
    const lines = [
      `Workflow: ${spec.name}`,
      spec.description ? spec.description : '',
      spec.pattern ? `Pattern: ${spec.pattern}` : '',
      '',
      renderWorkflowAscii(spec),
      '',
      formatValidation(spec, validation),
      '',
      'Mermaid:',
      renderWorkflowMermaid(spec),
    ].filter(line => line !== '')
    return { type: 'text', value: lines.join('\n') }
  }

  if (command === 'plan') {
    const validation = validateWorkflow(spec)
    if (!validation.valid) {
      setFailure()
      return { type: 'text', value: formatValidation(spec, validation) }
    }
    const plan = buildRunPlan(spec, loadRunState(cwd, name))
    if (json) return { type: 'text', value: JSON.stringify(plan, null, 2) }
    return { type: 'text', value: formatRunPlan(plan) }
  }

  if (command === 'next') {
    const validation = validateWorkflow(spec)
    if (!validation.valid) {
      setFailure()
      return { type: 'text', value: formatValidation(spec, validation) }
    }
    const plan = buildRunPlan(spec, loadRunState(cwd, name))
    if (!plan.nextStepId) {
      return {
        type: 'text',
        value:
          plan.completed === plan.total
            ? `Workflow ${name} is complete.`
            : `No ready step for ${name} (blocked or cyclic).`,
      }
    }
    const step = spec.steps.find(s => s.id === plan.nextStepId)
    if (!step) {
      setFailure()
      return {
        type: 'text',
        value: `Next step ${plan.nextStepId} missing from spec.`,
      }
    }
    if (json) return { type: 'text', value: JSON.stringify(step, null, 2) }
    const followUp =
      step.gate === 'approval'
        ? `When the run holds here, approve with: ur workflow approve ${name} ${step.id}`
        : step.gate === 'verification'
          ? 'The workflow runner must execute the verifier and receive a standalone VERDICT: PASS.'
          : `If this step was completed outside the workflow runner, record it with: ur workflow done ${name} ${step.id}`
    return {
      type: 'text',
      value: [
        `Next step: ${step.id} (${step.name})`,
        step.gate ? `Gate: ${step.gate}` : '',
        `Agent type: ${step.agent}`,
        `Description: ${step.name}`,
        'Prompt:',
        step.prompt,
        '',
        'This is step metadata, not a tool invocation.',
        `Execute through the checkpointed workflow runner: ur workflow run ${name} --resume`,
        followUp,
      ]
        .filter(line => line !== '')
        .join('\n'),
    }
  }

  if (command === 'done') {
    const stepId = positional[2]
    if (!stepId) {
      setFailure(2)
      return { type: 'text', value: `Usage: ur workflow done ${name} <stepId>` }
    }
    const step = spec.steps.find(candidate => candidate.id === stepId)
    if (!step) {
      setFailure()
      return { type: 'text', value: `No step "${stepId}" in workflow ${name}.` }
    }
    if (step.gate != null) {
      setFailure()
      return {
        type: 'text',
        value:
          step.gate === 'approval'
            ? `Step "${stepId}" is approval-gated and cannot be bypassed with done. Run the workflow until it holds, then use: ur workflow approve ${name} ${stepId}`
            : `Step "${stepId}" is verification-gated and cannot be bypassed with done. Run its verifier and require VERDICT: PASS.`,
      }
    }
    const completed = normalizeWorkflowCompleted(
      spec,
      loadRunState(cwd, name)?.completed ?? [],
    )
    const incompleteDependencies = (step.dependsOn ?? []).filter(
      dependency => !completed.includes(dependency),
    )
    if (incompleteDependencies.length > 0) {
      setFailure()
      return {
        type: 'text',
        value: `Cannot mark "${stepId}" complete before: ${incompleteDependencies.join(', ')}.`,
      }
    }
    const nextCompleted = [...new Set([...completed, stepId])]
    setRunCompleted(cwd, name, nextCompleted)
    if (step.checkpoint) {
      markRunCheckpoint(cwd, name, stepId, nextCompleted)
    }
    if (nextCompleted.length === spec.steps.length) {
      markRunStatus(cwd, name, 'completed')
    }
    const plan = buildRunPlan(spec, loadRunState(cwd, name))
    if (json) return { type: 'text', value: JSON.stringify(plan, null, 2) }
    return { type: 'text', value: `Marked ${stepId} complete.\n\n${formatRunPlan(plan)}` }
  }

  if (command === 'approve') {
    const stepId = positional[2]
    if (!stepId) {
      setFailure(2)
      return {
        type: 'text',
        value: `Usage: ur workflow approve ${name} <stepId>`,
      }
    }
    const step = spec.steps.find(candidate => candidate.id === stepId)
    if (!step) {
      setFailure()
      return { type: 'text', value: `No step "${stepId}" in workflow ${name}.` }
    }
    if (step.gate !== 'approval') {
      setFailure()
      return {
        type: 'text',
        value: `Step "${stepId}" is not an approval gate.`,
      }
    }
    try {
      const state = approveWorkflowStep(cwd, name, stepId)
      if (json) {
        return { type: 'text', value: JSON.stringify(state, null, 2) }
      }
      return {
        type: 'text',
        value: `Approved ${stepId}. Resume safely with: ur workflow run ${name} --resume`,
      }
    } catch (error) {
      setFailure()
      return {
        type: 'text',
        value: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (command === 'reset') {
    resetRunState(cwd, name)
    return { type: 'text', value: `Reset run state for ${name}.` }
  }

  if (command === 'run') {
    const validation = validateWorkflow(spec)
    if (!validation.valid) {
      setFailure()
      return { type: 'text', value: formatValidation(spec, validation) }
    }
    const dryRun = flags.has('--dry-run')
    const resume = flags.has('--resume')
    const skipPermissions =
      flags.has('--skip-permissions') ||
      flags.has('--dangerously-skip-permissions')
    const maxTurnsRaw = values.get('--max-turns')
    const concurrencyRaw = values.get('--concurrency')
    const maxTurnsValue = Number(maxTurnsRaw ?? '30')
    const concurrencyValue = Number(concurrencyRaw ?? '')
    if (
      maxTurnsRaw !== undefined &&
      (!Number.isSafeInteger(maxTurnsValue) || maxTurnsValue < 1)
    ) {
      setFailure(2)
      return {
        type: 'text',
        value: '--max-turns must be a positive integer.',
      }
    }
    if (
      concurrencyRaw !== undefined &&
      (!Number.isSafeInteger(concurrencyValue) || concurrencyValue < 1)
    ) {
      setFailure(2)
      return {
        type: 'text',
        value: '--concurrency must be a positive integer.',
      }
    }
    const maxConcurrency =
      concurrencyRaw === undefined ? undefined : concurrencyValue
    const live = flags.has('--live') && !json
    const board = live
      ? new LiveExecutionBoard(
          spec.name,
          validation.order.map(id => {
            const step = spec.steps.find(s => s.id === id)
            return { id, agent: step?.agent ?? 'general-purpose' }
          }),
        )
      : null
    const result = await runWorkflowSpec(spec, {
      cwd,
      stateName: name,
      dryRun,
      resume,
      skipPermissions,
      maxTurns: maxTurnsValue,
      maxConcurrency,
      onEvent: board
        ? event => {
            board.apply(event)
            const line = formatLiveEvent(event)
            // Stream progress on stderr so it never corrupts stdout/JSON output.
            if (line) process.stderr.write(`${line}\n`)
          }
        : undefined,
    })
    if (result.status !== 'completed') setFailure()
    if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
    const header = dryRun ? '(dry run — no model calls)\n\n' : ''
    const liveBoard = board ? `${board.renderBoard()}\n\n` : ''
    return { type: 'text', value: `${header}${liveBoard}${formatExecResult(result)}` }
  }

  setFailure()
  return { type: 'text', value: `Unknown workflow command: ${command}` }
}

export const call: LocalCommandCall = async (args, context) => {
  let exitCode = 0
  const externalSetExitCode = (
    context as unknown as
      | { setExitCode?: (code: number) => void }
      | undefined
  )?.setExitCode
  const result = await callWorkflow(args, (code = 1) => {
    exitCode = code
    externalSetExitCode?.(code)
  })
  return exitCode === 0 ? result : { ...result, exitCode }
}
