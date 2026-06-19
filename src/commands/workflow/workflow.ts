import { formatExecResult } from '../../services/agents/executor.js'
import {
  LiveExecutionBoard,
  formatLiveEvent,
} from '../../services/agents/liveBoard.js'
import { runWorkflowSpec } from '../../services/agents/runWorkflow.js'
import {
  type WorkflowSpec,
  buildRunPlan,
  formatRunPlan,
  formatValidation,
  listWorkflows,
  loadRunState,
  loadWorkflow,
  markStepComplete,
  renderWorkflowAscii,
  renderWorkflowMermaid,
  resetRunState,
  saveWorkflow,
  validateWorkflow,
} from '../../services/agents/workflows.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function optionValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
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

function notFound(name: string): { type: 'text'; value: string } {
  const available = listWorkflows(getCwd())
  const hint = available.length > 0 ? `\nAvailable: ${available.join(', ')}` : ''
  return {
    type: 'text',
    value: `Workflow not found: ${name}${hint}\nCreate one: ur workflow init ${name}`,
  }
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const ascii = tokens.includes('--ascii')
  const force = tokens.includes('--force')
  const positional = tokens.filter(token => !token.startsWith('--'))
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
    return {
      type: 'text',
      value: result.created
        ? `Created workflow ${spec.name} at ${result.path}`
        : `Workflow already exists at ${result.path} (use --force to overwrite)`,
    }
  }

  if (!name) {
    return { type: 'text', value: `Usage: ur workflow ${command} <name>` }
  }
  const spec = loadWorkflow(cwd, name)
  if (!spec) return notFound(name)

  if (command === 'validate') {
    const validation = validateWorkflow(spec)
    if (json) return { type: 'text', value: JSON.stringify(validation, null, 2) }
    return { type: 'text', value: formatValidation(spec, validation) }
  }

  if (command === 'graph') {
    const value = ascii ? renderWorkflowAscii(spec) : renderWorkflowMermaid(spec)
    return { type: 'text', value }
  }

  if (command === 'show') {
    const validation = validateWorkflow(spec)
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
    const plan = buildRunPlan(spec, loadRunState(cwd, name))
    if (json) return { type: 'text', value: JSON.stringify(plan, null, 2) }
    return { type: 'text', value: formatRunPlan(plan) }
  }

  if (command === 'next') {
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
    if (!step) return { type: 'text', value: `Next step ${plan.nextStepId} missing from spec.` }
    if (json) return { type: 'text', value: JSON.stringify(step, null, 2) }
    return {
      type: 'text',
      value: [
        `Next step: ${step.id} (${step.name})`,
        step.gate ? `Gate: ${step.gate}` : '',
        '',
        `Agent({ subagent_type: "${step.agent}", description: ${JSON.stringify(step.name)}, prompt: ${JSON.stringify(step.prompt)} })`,
        '',
        `Mark complete: ur workflow done ${name} ${step.id}`,
      ]
        .filter(line => line !== '')
        .join('\n'),
    }
  }

  if (command === 'done') {
    const stepId = positional[2]
    if (!stepId) return { type: 'text', value: `Usage: ur workflow done ${name} <stepId>` }
    if (!spec.steps.some(s => s.id === stepId)) {
      return { type: 'text', value: `No step "${stepId}" in workflow ${name}.` }
    }
    markStepComplete(cwd, name, stepId)
    const plan = buildRunPlan(spec, loadRunState(cwd, name))
    if (json) return { type: 'text', value: JSON.stringify(plan, null, 2) }
    return { type: 'text', value: `Marked ${stepId} complete.\n\n${formatRunPlan(plan)}` }
  }

  if (command === 'reset') {
    resetRunState(cwd, name)
    return { type: 'text', value: `Reset run state for ${name}.` }
  }

  if (command === 'run') {
    const validation = validateWorkflow(spec)
    if (!validation.valid) {
      return { type: 'text', value: formatValidation(spec, validation) }
    }
    const dryRun = tokens.includes('--dry-run')
    const resume = tokens.includes('--resume')
    const skipPermissions =
      tokens.includes('--skip-permissions') ||
      tokens.includes('--dangerously-skip-permissions')
    const maxTurnsValue = Number(optionValue(tokens, '--max-turns') ?? '30')
    const concurrencyValue = Number(optionValue(tokens, '--concurrency') ?? '')
    const maxConcurrency =
      Number.isFinite(concurrencyValue) && concurrencyValue >= 1
        ? Math.floor(concurrencyValue)
        : undefined
    const live = tokens.includes('--live') && !json
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
      maxTurns: Number.isFinite(maxTurnsValue) && maxTurnsValue > 0 ? maxTurnsValue : 30,
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
    if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
    const header = dryRun ? '(dry run — no model calls)\n\n' : ''
    const liveBoard = board ? `${board.renderBoard()}\n\n` : ''
    return { type: 'text', value: `${header}${liveBoard}${formatExecResult(result)}` }
  }

  return { type: 'text', value: `Unknown workflow command: ${command}` }
}
