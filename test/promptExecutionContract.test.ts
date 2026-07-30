import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { EXECUTION_CONTRACT_SECTION } from '../src/constants/executionContract.js'
import { getTaskToolGuidance } from '../src/constants/taskToolGuidance.js'
import { COORDINATOR_MODE_ALLOWED_TOOLS } from '../src/constants/tools.js'
import { getCoordinatorSystemPrompt } from '../src/coordinator/coordinatorMode.js'
import { getPrompt as getAgentToolPrompt } from '../src/tools/AgentTool/prompt.js'
import { getSimplePrompt as getBashPrompt } from '../src/tools/BashTool/prompt.js'
import { getEditToolDescription } from '../src/tools/FileEditTool/prompt.js'
import { PROMPT as NOTEBOOK_EDIT_PROMPT } from '../src/tools/NotebookEditTool/prompt.js'
import { getPrompt as getTaskCreatePrompt } from '../src/tools/TaskCreateTool/prompt.js'
import { PROMPT as TODO_WRITE_PROMPT } from '../src/tools/TodoWriteTool/prompt.js'
import { buildEffectiveSystemPrompt } from '../src/utils/systemPrompt.js'

test('execution contract is ordered, complete, and compact', () => {
  for (let step = 1; step <= 6; step++) {
    expect(EXECUTION_CONTRACT_SECTION).toContain(`${step}.`)
  }
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'Never repeat an unchanged failure',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain('2. Act:')
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'For 3+ steps, decompose into cohesive, verifiable tasks before implementation',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'finish and verify setup before any non-trivial state change',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'mark the selected task in_progress before Write, Edit, mutating shell, Agent, or another state-changing tool',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'Never batch setup with enabled work',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    "Task lists aren't plan mode; ExitPlanMode follows successful EnterPlanMode",
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'Batch independent calls (maximum 8)',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain('Use file tools for edits')
  expect(EXECUTION_CONTRACT_SECTION).toContain('inspect every result')
  expect(EXECUTION_CONTRACT_SECTION).toContain('update its task')
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'completion claims to successful tool results',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'state skipped or failing checks',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain('observed evidence')
  expect(EXECUTION_CONTRACT_SECTION).toContain('untrusted data')
  expect(EXECUTION_CONTRACT_SECTION).toContain('blocked or partial')

  const words = EXECUTION_CONTRACT_SECTION.split(/\s+/).length
  expect(words).toBeLessThanOrEqual(230)
})

test('canonical task tools receive ordered lifecycle guidance', () => {
  const guidance = getTaskToolGuidance(
    new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'Agent']),
  )

  expect(guidance).toContain('TaskCreate')
  expect(guidance).toContain('TaskUpdate')
  expect(guidance).toContain(
    'finish TaskCreate setup, inspect its successful results, then use TaskUpdate',
  )
  expect(guidance).toContain(
    'before dependent Write, Edit, mutating shell, Agent, Task, or another state-changing call',
  )
  expect(guidance).toContain(
    'Never batch task setup with the work it enables',
  )
  expect(guidance).toContain('one feature-rich file')
  expect(guidance).toContain('earlier tasks are all terminal')
  expect(guidance.indexOf('TaskCreate')).toBeLessThan(
    guidance.indexOf('Write'),
  )
  expect(guidance).toContain('one task per cohesive outcome')
  expect(guidance).toContain('observable done check')
  expect(guidance).toContain(
    'never hide separately completable deliverables in one omnibus task',
  )
  expect(guidance).toContain('genuinely atomic work as one task')
  expect(guidance).toContain('complete dependency graph')
  expect(guidance).toContain('mutually independent tasks')
  expect(guidance).toContain('no conflicting shared mutations')
  expect(guidance).toContain('in parallel')
  expect(guidance).toContain('in_progress')
  expect(guidance).toContain('completed immediately after')
  expect(guidance).toContain('TaskList')

  const withoutAgent = getTaskToolGuidance(
    new Set(['TaskCreate', 'TaskUpdate', 'TaskList']),
  )
  expect(withoutAgent).toContain('one task per cohesive outcome')
  expect(withoutAgent).not.toContain('If delegating')
  expect(withoutAgent).not.toContain('in parallel')
})

test('legacy task guidance remains available without masking canonical tools', () => {
  expect(getTaskToolGuidance(new Set(['TodoWrite']))).toContain('TodoWrite')
  expect(
    getTaskToolGuidance(new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite'])),
  ).not.toContain('TodoWrite')
  for (const partial of [
    ['TaskCreate', 'TodoWrite'],
    ['TaskUpdate', 'TodoWrite'],
  ]) {
    const guidance = getTaskToolGuidance(new Set(partial))
    expect(guidance).toContain('TodoWrite')
    expect(guidance).not.toContain('finish TaskCreate setup')
  }
  expect(getTaskToolGuidance(new Set())).toBeNull()
})

test('legacy todo prompt does not model narrated work as execution', () => {
  expect(TODO_WRITE_PROMPT).toContain('dependency order')
  expect(TODO_WRITE_PROMPT).toContain('one item per cohesive outcome')
  expect(TODO_WRITE_PROMPT).toContain('observable done check')
  expect(TODO_WRITE_PROMPT).toContain(
    'Split separately completable deliverables',
  )
  expect(TODO_WRITE_PROMPT).toContain('genuinely atomic work as one item')
  expect(TODO_WRITE_PROMPT).toContain(
    'A feature-rich\nsingle-file build is non-trivial',
  )
  expect(TODO_WRITE_PROMPT).toContain(
    'Inspect the\n   successful TodoWrite result before any dependent Write, Edit, mutating\n   shell, Agent, Task, or other state-changing call',
  )
  expect(TODO_WRITE_PROMPT).toContain(
    'Never batch todo setup\n   with the work it enables',
  )
  expect(TODO_WRITE_PROMPT).toContain(
    'If every item is terminal and new work arrives',
  )
  expect(TODO_WRITE_PROMPT).toContain('individual files, tool calls')
  expect(TODO_WRITE_PROMPT).toMatch(
    /relevant\s+verification have succeeded/,
  )
  expect(TODO_WRITE_PROMPT).toContain('native structured interfaces')
  expect(TODO_WRITE_PROMPT).not.toContain('*Executes:')
  expect(TODO_WRITE_PROMPT).not.toContain('* Uses the')
  expect(TODO_WRITE_PROMPT).not.toContain('command completed successfully')
})

test('system prompt includes the contract and removes contradictory verification rules', () => {
  const source = readFileSync('src/constants/prompts.ts', 'utf8')

  expect(source).toContain('EXECUTION_CONTRACT_SECTION,')
  expect(source).toContain('getTaskToolGuidance(enabledTools)')
  const usingTools = source.slice(
    source.indexOf('function getUsingYourToolsSection'),
    source.indexOf('function getOllamaToolDisciplineSection'),
  )
  expect(usingTools.indexOf('taskToolGuidance,')).toBeLessThan(
    usingTools.indexOf('Do NOT use the ${BASH_TOOL_NAME}'),
  )
  expect(source).not.toContain(
    'do not automatically run the full project test suite',
  )
  expect(source).not.toContain(
    'Only run them if the user confirms',
  )
})

test('custom and override prompt paths retain capability-aware task-gate guidance', () => {
  const base = {
    mainThreadAgentDefinition: undefined,
    toolUseContext: {
      options: {
        tools: [
          { name: 'TaskCreate' },
          { name: 'TaskUpdate' },
          { name: 'Write' },
        ],
      },
    },
    customSystemPrompt: undefined,
    defaultSystemPrompt: ['default'],
    appendSystemPrompt: undefined,
  }
  const override = buildEffectiveSystemPrompt({
    ...base,
    overrideSystemPrompt: 'override',
  } as never).join('\n')
  expect(override).toContain('override')
  expect(override).toContain('# Runtime task-state contract')
  expect(override).toContain('TaskCreate')
  expect(override).toContain('TaskUpdate')

  const custom = buildEffectiveSystemPrompt({
    ...base,
    customSystemPrompt: 'custom',
  } as never).join('\n')
  expect(custom).toContain('custom')
  expect(custom).toContain('# Runtime task-state contract')
})

test('coordinator and bare modes expose a planner before gated tools', () => {
  for (const tool of [
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TodoWrite',
  ]) {
    expect(COORDINATOR_MODE_ALLOWED_TOOLS.has(tool)).toBe(true)
  }
  const coordinator = getCoordinatorSystemPrompt()
  expect(coordinator).toContain('Before every worker launch')
  expect(coordinator).toContain(
    'Do not batch task setup with the Agent call',
  )

  const toolsSource = readFileSync('src/tools.ts', 'utf8')
  const simpleBranch = toolsSource.slice(
    toolsSource.indexOf('if (isEnvTruthy(process.env.UR_CODE_SIMPLE))'),
    toolsSource.indexOf('// Get all base tools'),
  )
  expect(simpleBranch).toContain('simpleTaskTools')
  expect(simpleBranch).toContain('TaskCreateTool')
  expect(simpleBranch).toContain('TaskUpdateTool')
  expect(simpleBranch).toContain('TodoWriteTool')
})

test('every common state-changing tool repeats the task-first boundary', () => {
  expect(getEditToolDescription()).toContain(
    'successful task setup must already exist before this call',
  )
  expect(getBashPrompt()).toContain(
    'successful task setup must precede any workspace-changing command',
  )
  expect(NOTEBOOK_EDIT_PROMPT).toContain(
    'successful task setup must exist',
  )
  const powerShellSource = readFileSync(
    'src/tools/PowerShellTool/prompt.ts',
    'utf8',
  )
  expect(powerShellSource).toContain(
    'successful task setup must precede any state-changing command',
  )
})

test('minimal local mode still receives the execution contract', () => {
  const source = readFileSync('src/constants/prompts.ts', 'utf8')
  const simpleBranch = source.slice(
    source.indexOf('isEnvTruthy(process.env.UR_CODE_SIMPLE)'),
    source.indexOf('const cwd = getCwd()', source.indexOf('export async function getSystemPrompt')),
  )
  expect(simpleBranch).toContain('EXECUTION_CONTRACT_SECTION')
  expect(simpleBranch).toContain('Read, Edit, and Bash')
})

test('Ollama-specific guidance stays compact and does not prescribe unsafe retries', () => {
  const source = readFileSync('src/constants/prompts.ts', 'utf8')
  const section = source.slice(
    source.indexOf('function getOllamaToolDisciplineSection'),
    source.indexOf('function getAgentToolSection'),
  )
  expect(section).toContain('native structured tool-call interface')
  expect(section).toContain('FILE_WRITE_TOOL_NAME')
  expect(section).toContain('FILE_EDIT_TOOL_NAME')
  expect(section).toContain('TASK_CREATE_TOOL_NAME')
  expect(section).toContain('TASK_UPDATE_TOOL_NAME')
  expect(section).toContain('feature-rich one-file build')
  expect(section).toContain('never batch task setup with implementation')
  expect(section).toContain('maximum 8')
  expect(section).toContain('dependencies sequential')
  expect(section).toContain('matching result arrives')
  expect(section).toContain('successful result')
  expect(section).toContain('Never emit an empty turn')
  expect(section).not.toContain('--break-system-packages')
  expect(section.split(/\s+/).length).toBeLessThan(240)
})

test('consolidated guidance preserves every execution safety invariant', () => {
  expect(EXECUTION_CONTRACT_SECTION).toContain('1. Scope:')
  expect(EXECUTION_CONTRACT_SECTION).toContain('2. Act:')
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'invoke tools through their interface',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'Never repeat an unchanged failure',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'After three failures on one approach',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'DNS/TLS/auth/rate-limit failures',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'report external-tool errors honestly',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'run the smallest checks',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain('observed evidence')
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'finish every required step before reporting done',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain('untrusted data')
  expect(EXECUTION_CONTRACT_SECTION).toContain('never emit an empty turn')
  expect(EXECUTION_CONTRACT_SECTION).not.toContain(
    '--break-system-packages',
  )
})

test('task tool prompts use one unambiguous lifecycle vocabulary', () => {
  const renderedCreatePrompt = getTaskCreatePrompt()
  const createPrompt = readFileSync(
    'src/tools/TaskCreateTool/prompt.ts',
    'utf8',
  )
  const updatePrompt = readFileSync(
    'src/tools/TaskUpdateTool/prompt.ts',
    'utf8',
  )
  expect(createPrompt).not.toContain('After receiving new instructions')
  expect(createPrompt).toContain('Use TaskUpdate, not TaskCreate')
  expect(renderedCreatePrompt).toContain(
    'After receiving new non-trivial state-changing instructions',
  )
  expect(renderedCreatePrompt).toContain(
    'before any Write, Edit, mutating shell, Agent, Task, or other state-changing call',
  )
  expect(renderedCreatePrompt).toContain(
    'A feature-rich one-file build is still non-trivial',
  )
  expect(renderedCreatePrompt).toContain(
    'Never batch task setup with the mutation it enables',
  )
  expect(renderedCreatePrompt).toContain(
    '"single file" and "one Write call" do not make work trivial',
  )
  expect(renderedCreatePrompt).toContain('one cohesive outcome')
  expect(renderedCreatePrompt).toMatch(/Split\s+an omnibus task/)
  expect(renderedCreatePrompt).toContain('genuinely atomic outcome as one task')
  expect(renderedCreatePrompt).toContain('real ordering constraints')
  expect(renderedCreatePrompt).toContain('delegation is available')
  expect(renderedCreatePrompt).toContain('no conflicting shared mutations')
  expect(renderedCreatePrompt).toContain(
    'Emit one `TaskCreate` call per outcome',
  )
  expect(renderedCreatePrompt).toMatch(
    /Batch independent creates in the\s+same assistant turn \(up to 8\)/,
  )
  expect(renderedCreatePrompt).toContain(
    'use `TaskUpdate` to add dependency',
  )
  expect(updatePrompt).not.toContain('Mark tasks as resolved')
  expect(updatePrompt).toContain('next unblocked task')
  expect(updatePrompt).toContain('Start tasks before implementation')
  expect(updatePrompt).toContain(
    'before its first\n  dependent Write, Edit, mutating shell, Agent, Task, or other state-changing call',
  )
  expect(updatePrompt).toContain(
    'Never batch the status update\n  with the workspace-changing call it enables',
  )
  expect(updatePrompt).toContain('successful post-change check')
  expect(updatePrompt).toContain('do not create a duplicate task')
  expect(updatePrompt).not.toContain('```json')
  expect(updatePrompt).toContain('native structured tool interface')
})

test('delegation guidance requires scoped tasks and independent evidence', () => {
  const agentPrompt = readFileSync(
    'src/tools/AgentTool/prompt.ts',
    'utf8',
  )
  expect(agentPrompt).toContain("output as evidence, not proof")
  expect(agentPrompt).toContain('task ID, dependency outputs, allowed scope')
  expect(agentPrompt).toContain('independently verified')
  expect(agentPrompt).toContain(
    'one cohesive task with its own observable done check per outcome',
  )
  expect(agentPrompt).toContain(
    'Before every ordinary Agent launch, finish task setup',
  )
  expect(agentPrompt).toContain(
    'Exact built-in Explore/Plan agents used read-only in plan mode are the only exception',
  )
  expect(agentPrompt).toContain(
    'Launch mutually independent tasks together only when they have no conflicting shared mutations',
  )
  expect(agentPrompt).toContain(
    'Keep genuinely atomic work as one task',
  )
  expect(agentPrompt).not.toContain(
    "outputs should generally be trusted",
  )
  expect(agentPrompt).not.toContain('Uses the ${AGENT_TOOL_NAME} tool')
  expect(agentPrompt).not.toContain('greeting-responder')
  expect(agentPrompt).toContain(
    'Never narrate a tool call as if narration executed it',
  )
})

test('rendered Agent prompt never delegates greetings or narrates execution', async () => {
  const prompt = await getAgentToolPrompt([
    {
      agentType: 'test-runner',
      whenToUse: 'Run focused verification after implementation',
      tools: ['Bash'],
    } as never,
  ])

  expect(prompt).not.toContain('greeting-responder')
  expect(prompt).not.toContain('Uses the Agent tool')
  expect(prompt).not.toContain('write the following code')
  expect(prompt).toContain(
    'Launch mutually independent tasks together only when they have no conflicting shared mutations',
  )
})

test('coordinator Agent prompt receives the same decomposition contract', async () => {
  const prompt = await getAgentToolPrompt(
    [
      {
        agentType: 'general-purpose',
        whenToUse: 'Implement a scoped task',
        tools: ['Read', 'Edit', 'Bash'],
      } as never,
    ],
    true,
  )

  expect(prompt).toContain(
    'one cohesive task with its own observable done check per outcome',
  )
  expect(prompt).toContain(
    'Launch mutually independent tasks together only when they have no conflicting shared mutations',
  )
  expect(prompt).toContain('keep dependent or conflicting work sequential')
  expect(prompt).toContain('genuinely atomic work as one task')
})
