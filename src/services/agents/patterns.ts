import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type WorkflowGate,
  type WorkflowSpec,
  renderWorkflowMermaid,
  saveWorkflow,
} from './workflows.js'

/**
 * Named multi-agent collaboration patterns.
 *
 * PEER (Plan -> Execute -> Express -> Review) and DOE (Data-finding ->
 * Opinion-inject -> Express) are structured ways to decompose a task across
 * specialized subagents with an explicit review/iterate loop. Each pattern
 * maps onto UR's built-in subagents and compiles into a checkpointed workflow,
 * so the same definition can be planned, rendered, scaffolded, and executed by
 * coordinator mode via the Agent tool.
 */

export type PatternStage = {
  id: string
  role: string
  /** UR subagent_type that plays this role. */
  agent: string
  goal: string
  /** Prompt template; {{task}} is substituted, {{prior}} references upstream output. */
  prompt: string
  /**
   * Explicit upstream stage ids. When omitted the stage chains to the previous
   * stage (a linear pipeline); when set it can fan out (no deps) or fan in
   * (several deps), letting a pattern describe a DAG rather than only a chain.
   */
  dependsOn?: string[]
  parallelizable?: boolean
  gate?: WorkflowGate
  checkpoint?: boolean
}

export type PatternLoop = {
  from: string
  to: string
  condition: string
  maxIterations: number
}

export type AgentPattern = {
  id: string
  name: string
  acronym: string
  summary: string
  bestFor: string[]
  stages: PatternStage[]
  loop: PatternLoop | null
  reference: string
}

export const AGENT_PATTERNS: AgentPattern[] = [
  {
    id: 'peer',
    name: 'PEER (Plan, Execute, Express, Review)',
    acronym: 'PEER',
    summary:
      'Decompose a complex task, execute it step by step, synthesize the result, then critically review and iterate until it passes. Best for reasoning-heavy or multi-step work.',
    bestFor: [
      'multi-step features and refactors',
      'reasoning-intensive analysis',
      'work that benefits from an explicit critique loop',
    ],
    reference: 'https://github.com/agentuniverse-ai/agentUniverse',
    loop: {
      from: 'review',
      to: 'plan',
      condition: 'review verdict is not PASS',
      maxIterations: 3,
    },
    stages: [
      {
        id: 'plan',
        role: 'Planner',
        agent: 'plan',
        goal: 'Break the task into an ordered, minimal set of concrete steps.',
        prompt:
          'Decompose this task into an ordered, minimal set of concrete steps. For each step give the goal and a crisp acceptance check. Surface unknowns and risks up front.\n\nTask: {{task}}',
        checkpoint: true,
      },
      {
        id: 'execute',
        role: 'Executor',
        agent: 'worker',
        goal: 'Carry out the plan, verifying each step as you go.',
        prompt:
          'Execute the plan for the task below. Implement each step and run the smallest useful verification (tests, typecheck, lint, build) after each. Report exactly what you changed and the command results.\n\nTask: {{task}}\n\nPlan from the Planner:\n{{prior}}',
        parallelizable: true,
        checkpoint: true,
      },
      {
        id: 'express',
        role: 'Expressor',
        agent: 'general-purpose',
        goal: 'Synthesize execution results into one coherent deliverable.',
        prompt:
          'Synthesize the execution results into a single coherent answer/deliverable for the task. Resolve contradictions, state assumptions, and present the final artifact clearly.\n\nTask: {{task}}\n\nExecution results:\n{{prior}}',
      },
      {
        id: 'review',
        role: 'Reviewer',
        agent: 'verification',
        goal: 'Critique the result and decide whether to iterate.',
        prompt:
          'Critically review the result against the task. Check correctness, completeness, regressions, and missing verification. End with exactly one line "VERDICT: PASS" or "VERDICT: FAIL" followed by specific, actionable feedback.\n\nTask: {{task}}\n\nResult to review:\n{{prior}}',
        gate: 'verification',
      },
    ],
  },
  {
    id: 'doe',
    name: 'DOE (Data-finding, Opinion-inject, Express)',
    acronym: 'DOE',
    summary:
      'Gather grounded data, inject expert judgment, then express a precise result. Best for data-intensive, source-grounded, or domain-expertise tasks.',
    bestFor: [
      'research and source-grounded reports',
      'data-intensive analysis requiring precision',
      'tasks where domain/expert opinion shapes the answer',
    ],
    reference: 'https://github.com/agentuniverse-ai/agentUniverse',
    loop: null,
    stages: [
      {
        id: 'data',
        role: 'Data finder',
        agent: 'docs-researcher',
        goal: 'Gather the data and primary sources the task needs.',
        prompt:
          'Gather the data and primary sources needed for this task. Prefer official/primary sources, keep each link with the fact it supports, and flag version/date sensitivity. Separate direct source facts from inference.\n\nTask: {{task}}',
        checkpoint: true,
      },
      {
        id: 'opinion',
        role: 'Domain expert',
        agent: 'general-purpose',
        goal: 'Apply expert judgment and constraints to the gathered data.',
        prompt:
          'Apply domain-expert judgment to the gathered data: weigh trade-offs, apply constraints, and inject the expertise needed to turn data into a defensible recommendation. Call out where evidence is thin.\n\nTask: {{task}}\n\nGathered data:\n{{prior}}',
      },
      {
        id: 'express',
        role: 'Expressor',
        agent: 'general-purpose',
        goal: 'Express the final, precise result with sources attached.',
        prompt:
          'Express the final result precisely. Attach sources to each material claim, state confidence, and keep the output scoped to what the task asked for.\n\nTask: {{task}}\n\nExpert analysis:\n{{prior}}',
        gate: 'verification',
      },
    ],
  },
  {
    id: 'concurrent',
    name: 'Concurrent (parallel analyses, then synthesize)',
    acronym: 'CONC',
    summary:
      'Run several independent analyses in parallel from different expert angles, then merge them into one synthesized result. Best when the sub-analyses do not depend on each other and breadth matters.',
    bestFor: [
      'breadth-first investigation of an unfamiliar area',
      'gathering multiple independent expert perspectives at once',
      'work whose sub-analyses are independent and can run concurrently',
    ],
    reference: 'https://openai.github.io/openai-agents-python/',
    loop: null,
    stages: [
      {
        id: 'survey',
        role: 'Code surveyor',
        agent: 'explore',
        goal: 'Map the parts of the codebase the task touches.',
        prompt:
          'Survey the codebase for everything relevant to this task: where the behavior lives, the key files, and how they connect. Report locations and structure, not opinions.\n\nTask: {{task}}',
        dependsOn: [],
        parallelizable: true,
      },
      {
        id: 'research',
        role: 'External researcher',
        agent: 'docs-researcher',
        goal: 'Gather external/primary-source context the task needs.',
        prompt:
          'Gather external context for this task from primary/official sources: relevant docs, APIs, specs, or prior art. Keep each link with the fact it supports and flag version/date sensitivity.\n\nTask: {{task}}',
        dependsOn: [],
        parallelizable: true,
      },
      {
        id: 'risks',
        role: 'Risk analyst',
        agent: 'security-auditor',
        goal: 'Identify risks, edge cases, and failure modes.',
        prompt:
          'Identify the risks, edge cases, security concerns, and failure modes relevant to this task. For each, note the realistic impact and what would have to be true for it to bite.\n\nTask: {{task}}',
        dependsOn: [],
        parallelizable: true,
      },
      {
        id: 'synthesize',
        role: 'Synthesizer',
        agent: 'general-purpose',
        goal: 'Merge the parallel findings into one coherent answer.',
        prompt:
          'Merge the parallel findings below into a single coherent answer for the task. Resolve conflicts between sources, state assumptions, and call out remaining gaps explicitly.\n\nTask: {{task}}\n\nParallel findings:\n{{prior}}',
        dependsOn: ['survey', 'research', 'risks'],
        gate: 'verification',
        checkpoint: true,
      },
    ],
  },
  {
    id: 'handoff',
    name: 'Handoff (triage, then delegate to a specialist)',
    acronym: 'HND',
    summary:
      'A triage agent classifies the request, selects the right specialist, and writes a focused brief; the specialist executes it; a verifier confirms the original request was met. Best for routing mixed incoming work.',
    bestFor: [
      'routing mixed or ambiguous requests to the right specialist',
      'triage-then-execute support workflows',
      'tasks where choosing the right approach is half the work',
    ],
    reference: 'https://openai.github.io/openai-agents-python/',
    loop: null,
    stages: [
      {
        id: 'triage',
        role: 'Triage',
        agent: 'general-purpose',
        goal: 'Classify the request and select the specialist to own it.',
        prompt:
          'Classify this request, decide which kind of specialist should own it (e.g. coding, testing, security, docs, browser), and write a focused brief for that specialist: the goal, the constraints, and the acceptance check.\n\nTask: {{task}}',
        dependsOn: [],
        checkpoint: true,
      },
      {
        id: 'handle',
        role: 'Specialist',
        agent: 'worker',
        goal: 'Execute the task per the triage brief, verifying as you go.',
        prompt:
          'You are the specialist selected by triage. Execute the task according to the brief below, running the smallest useful verification after each meaningful change. Report exactly what you did and the results.\n\nTask: {{task}}\n\nTriage brief:\n{{prior}}',
        dependsOn: ['triage'],
      },
      {
        id: 'verify',
        role: 'Verifier',
        agent: 'verification',
        goal: 'Confirm the specialist satisfied the original request.',
        prompt:
          'Confirm the specialist work below satisfies the original request. Check correctness, completeness, and missing verification. End with exactly one line "VERDICT: PASS" or "VERDICT: FAIL" followed by specific feedback.\n\nTask: {{task}}\n\nSpecialist result:\n{{prior}}',
        dependsOn: ['handle'],
        gate: 'verification',
      },
    ],
  },
  {
    id: 'parallel',
    name: 'Parallel specialized subagents',
    acronym: 'PAR',
    summary:
      'Run multiple specialist agents in parallel — bug finder, patch writer, test writer, security auditor, style reviewer — then synthesize their outputs into one coherent plan. Best for complex code changes that need independent expert scrutiny before integration.',
    bestFor: [
      'complex code changes needing independent expert review',
      'tasks where bug-finding, patching, testing, security, and style can be separated',
      'high-confidence patches that must survive multiple adversarial checks',
    ],
    reference: 'https://openai.github.io/openai-agents-python/',
    loop: null,
    stages: [
      {
        id: 'find-bugs',
        role: 'Bug finder',
        agent: 'reviewer',
        goal: 'Find concrete bugs in the code relevant to the task.',
        prompt:
          'Find bugs in the code related to: {{task}}. List concrete issues with file paths and line numbers. Do not write fixes; only identify problems. End with VERDICT: PASS if no serious bugs were found, or VERDICT: FAIL with the bug list.',
        dependsOn: [],
        parallelizable: true,
      },
      {
        id: 'write-patch',
        role: 'Patch writer',
        agent: 'worker',
        goal: 'Write the minimal correct patch for the task.',
        prompt:
          'Write the minimal patch for: {{task}}. Return only the code changes and a VERDICT line. Do not write tests or prose; focus on the implementation.',
        dependsOn: [],
        parallelizable: true,
      },
      {
        id: 'write-tests',
        role: 'Test writer',
        agent: 'test-runner',
        goal: 'Write tests that exercise the expected behavior.',
        prompt:
          'Write tests for: {{task}}. Run them and report results. End with VERDICT: PASS if tests pass, or VERDICT: FAIL with failure output.',
        dependsOn: [],
        parallelizable: true,
      },
      {
        id: 'security-review',
        role: 'Security auditor',
        agent: 'security-auditor',
        goal: 'Review the task for security vulnerabilities and unsafe patterns.',
        prompt:
          'Security review for: {{task}}. Report any vulnerabilities, unsafe patterns, or trust-boundary issues. End with VERDICT: PASS if no serious issues, or VERDICT: FAIL with specifics.',
        dependsOn: [],
        parallelizable: true,
      },
      {
        id: 'style-review',
        role: 'Style reviewer',
        agent: 'reviewer',
        goal: 'Review maintainability, style, and clarity.',
        prompt:
          'Style/review for: {{task}}. Report maintainability, clarity, naming, and consistency issues. End with VERDICT: PASS if acceptable, or VERDICT: FAIL with a concise punch list.',
        dependsOn: [],
        parallelizable: true,
      },
      {
        id: 'synthesize',
        role: 'Synthesizer',
        agent: 'general-purpose',
        goal: 'Merge parallel findings into one coherent, actionable plan.',
        prompt:
          'Synthesize the parallel reviews and patch above into a single coherent plan for: {{task}}. Resolve conflicts between findings. Produce a unified patch/test/security/style recommendation. End with VERDICT: PASS if ready to apply, or VERDICT: FAIL if more work is needed.',
        dependsOn: ['find-bugs', 'write-patch', 'write-tests', 'security-review', 'style-review'],
        gate: 'verification',
        checkpoint: true,
      },
    ],
  },
  {
    id: 'debate',
    name: 'Debate (propose, critique, moderate)',
    acronym: 'DEB',
    summary:
      'One agent proposes a solution, an adversarial agent critiques it, and a moderator synthesizes the best answer — iterating until the moderator is satisfied. Best for high-stakes decisions that benefit from an explicit adversarial check.',
    bestFor: [
      'high-stakes decisions needing an adversarial check',
      'choosing between competing approaches or designs',
      'reducing single-agent blind spots on contested problems',
    ],
    reference: 'https://github.com/agentuniverse-ai/agentUniverse',
    loop: {
      from: 'moderate',
      to: 'propose',
      condition: 'moderator verdict is not PASS',
      maxIterations: 2,
    },
    stages: [
      {
        id: 'propose',
        role: 'Proposer',
        agent: 'general-purpose',
        goal: 'Propose a concrete solution and argue why it is correct.',
        prompt:
          'Propose a concrete solution/answer to the task and argue why it is correct. Be specific and committal — state the approach, the key decisions, and the expected outcome.\n\nTask: {{task}}',
        dependsOn: [],
        checkpoint: true,
      },
      {
        id: 'critique',
        role: 'Critic',
        agent: 'reviewer',
        goal: 'Adversarially challenge the proposal.',
        prompt:
          'Adversarially challenge the proposal below: find flaws, missing cases, hidden assumptions, and risks. Be specific and concrete; do not soften. Where you would do it differently, say exactly how.\n\nTask: {{task}}\n\nProposal:\n{{prior}}',
        dependsOn: ['propose'],
      },
      {
        id: 'moderate',
        role: 'Moderator',
        agent: 'verification',
        goal: 'Synthesize the best answer and decide whether to iterate.',
        prompt:
          'Weigh the proposal and the critique and produce the best synthesized answer to the task. End with exactly one line "VERDICT: PASS" if the answer is sound and complete, otherwise "VERDICT: FAIL" followed by precisely what must change.\n\nTask: {{task}}\n\nProposal and critique:\n{{prior}}',
        dependsOn: ['critique'],
        gate: 'verification',
      },
    ],
  },
]

export function listPatterns(): AgentPattern[] {
  return AGENT_PATTERNS
}

export function getPattern(id: string): AgentPattern | undefined {
  return AGENT_PATTERNS.find(pattern => pattern.id === id.toLowerCase())
}

function substitute(template: string, task: string, prior: string): string {
  return template
    .replaceAll('{{task}}', task)
    .replaceAll('{{prior}}', prior)
}

export type ExecutionStep = {
  order: number
  stageId: string
  role: string
  agent: string
  goal: string
  prompt: string
  parallelizable: boolean
  gate?: WorkflowGate
}

export type ExecutionPlan = {
  patternId: string
  patternName: string
  task: string
  steps: ExecutionStep[]
  loop: PatternLoop | null
}

/** Resolve a stage's upstream dependencies (explicit, else the prior stage). */
function stageDeps(pattern: AgentPattern, index: number): string[] {
  const stage = pattern.stages[index]
  if (stage.dependsOn) return stage.dependsOn
  return index === 0 ? [] : [pattern.stages[index - 1].id]
}

export function buildExecutionPlan(
  pattern: AgentPattern,
  task: string,
): ExecutionPlan {
  const cleanTask = task.trim() || '<describe the task here>'
  const roleOf = (id: string): string =>
    pattern.stages.find(stage => stage.id === id)?.role ?? id
  const steps = pattern.stages.map((stage, index) => {
    const deps = stageDeps(pattern, index)
    const priorRef =
      deps.length === 0
        ? ''
        : deps.length === 1
          ? `output of the "${roleOf(deps[0])}" stage`
          : `combined outputs of the ${deps.map(id => `"${roleOf(id)}"`).join(', ')} stages`
    return {
      order: index + 1,
      stageId: stage.id,
      role: stage.role,
      agent: stage.agent,
      goal: stage.goal,
      prompt: substitute(stage.prompt, cleanTask, priorRef),
      parallelizable: stage.parallelizable === true,
      gate: stage.gate,
    }
  })
  return {
    patternId: pattern.id,
    patternName: pattern.name,
    task: cleanTask,
    steps,
    loop: pattern.loop,
  }
}

/** Compile a pattern (optionally bound to a task) into a checkpointed workflow. */
export function compilePatternToWorkflow(
  pattern: AgentPattern,
  task = '{{task}}',
): WorkflowSpec {
  const steps = pattern.stages.map((stage, index) => {
    const deps = stageDeps(pattern, index)
    // One dependency injects that step's output directly; several fan in via
    // {{prior}} (the executor joins every upstream output).
    const priorToken =
      deps.length === 0 ? '' : deps.length === 1 ? `{{${deps[0]}}}` : '{{prior}}'
    return {
      id: stage.id,
      name: stage.role,
      agent: stage.agent,
      prompt: substitute(stage.prompt, task, priorToken),
      dependsOn: deps,
      gate: stage.gate,
      checkpoint: stage.checkpoint === true,
    }
  })
  const loopNote = pattern.loop
    ? ` Loop: if ${pattern.loop.condition}, return from "${pattern.loop.from}" to "${pattern.loop.to}" (max ${pattern.loop.maxIterations} iterations).`
    : ''
  return {
    version: 1,
    name: pattern.id,
    description: `${pattern.summary}${loopNote}`,
    pattern: pattern.id,
    steps,
  }
}

export function renderPatternMermaid(pattern: AgentPattern): string {
  return renderWorkflowMermaid(compilePatternToWorkflow(pattern))
}

export type PatternScaffoldResult = {
  root: string
  created: string[]
  skipped: string[]
}

export function scaffoldPattern(
  cwd: string,
  id: string,
  options: { force?: boolean } = {},
): PatternScaffoldResult {
  const pattern = getPattern(id)
  const root = join(cwd, '.ur', 'patterns')
  const result: PatternScaffoldResult = { root, created: [], skipped: [] }
  if (!pattern) return result
  const force = options.force === true
  mkdirSync(root, { recursive: true })

  const specPath = join(root, `${pattern.id}.json`)
  if (!force && existsSync(specPath)) {
    result.skipped.push(`patterns/${pattern.id}.json`)
  } else {
    writeFileSync(specPath, `${JSON.stringify(pattern, null, 2)}\n`)
    result.created.push(`patterns/${pattern.id}.json`)
  }

  const workflow = compilePatternToWorkflow(pattern)
  const saved = saveWorkflow(cwd, workflow, { force })
  if (saved.created) result.created.push(`workflows/${pattern.id}.yaml`)
  else result.skipped.push(`workflows/${pattern.id}.yaml`)

  return result
}

export function formatPatternList(json: boolean): string {
  if (json) {
    return JSON.stringify({ patterns: AGENT_PATTERNS }, null, 2)
  }
  const lines = ['Multi-agent collaboration patterns', '']
  for (const pattern of AGENT_PATTERNS) {
    lines.push(`${pattern.acronym} — ${pattern.name}`)
    lines.push(`  ${pattern.summary}`)
    lines.push(
      `  Stages: ${pattern.stages.map(stage => `${stage.role} (${stage.agent})`).join(' -> ')}`,
    )
    if (pattern.loop) {
      lines.push(
        `  Loop: ${pattern.loop.from} -> ${pattern.loop.to} while ${pattern.loop.condition} (max ${pattern.loop.maxIterations})`,
      )
    }
    lines.push('')
  }
  lines.push('Run: ur pattern run peer "your task"')
  lines.push('Install role agents + workflow: ur pattern install peer')
  return lines.join('\n')
}

export function formatPatternDetail(pattern: AgentPattern, json: boolean): string {
  if (json) return JSON.stringify(pattern, null, 2)
  const lines = [
    `${pattern.acronym} — ${pattern.name}`,
    '',
    pattern.summary,
    '',
    'Best for:',
    ...pattern.bestFor.map(item => `  - ${item}`),
    '',
    'Stages:',
  ]
  for (const stage of pattern.stages) {
    const badges = [
      stage.parallelizable ? 'parallelizable' : null,
      stage.gate ? `${stage.gate} gate` : null,
      stage.checkpoint ? 'checkpoint' : null,
    ].filter(Boolean)
    lines.push(
      `  ${stage.role} → ${stage.agent}${badges.length ? `  [${badges.join(', ')}]` : ''}`,
    )
    lines.push(`    ${stage.goal}`)
  }
  if (pattern.loop) {
    lines.push('')
    lines.push(
      `Loop: when ${pattern.loop.condition}, return from "${pattern.loop.from}" to "${pattern.loop.to}" (max ${pattern.loop.maxIterations} iterations).`,
    )
  }
  lines.push('')
  lines.push('Mermaid:')
  lines.push(renderPatternMermaid(pattern))
  return lines.join('\n')
}

export function formatExecutionPlan(plan: ExecutionPlan, json: boolean): string {
  if (json) return JSON.stringify(plan, null, 2)
  const lines = [
    `${plan.patternName}`,
    `Task: ${plan.task}`,
    '',
    'Orchestration plan (run each stage as a subagent; feed each result into the next):',
    '',
  ]
  for (const step of plan.steps) {
    const tags = [
      step.parallelizable ? 'parallelizable' : null,
      step.gate ? `${step.gate} gate` : null,
    ].filter(Boolean)
    lines.push(
      `${step.order}. ${step.role} → subagent_type: ${step.agent}${tags.length ? `  [${tags.join(', ')}]` : ''}`,
    )
    lines.push(`   Goal: ${step.goal}`)
    lines.push(
      `   Agent({ subagent_type: "${step.agent}", description: "${step.role}: ${truncate(plan.task, 40)}", prompt: ${JSON.stringify(step.prompt)} })`,
    )
    lines.push('')
  }
  if (plan.loop) {
    lines.push(
      `Review loop: if the Reviewer does not return VERDICT: PASS, return to "${plan.loop.to}" with the feedback and repeat (max ${plan.loop.maxIterations} iterations).`,
    )
  }
  lines.push('')
  lines.push('Saved as a runnable workflow: ur workflow show ' + plan.patternId)
  return lines.join('\n')
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}
