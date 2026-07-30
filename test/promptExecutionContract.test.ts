import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { EXECUTION_CONTRACT_SECTION } from '../src/constants/executionContract.js'
import { getTaskToolGuidance } from '../src/constants/taskToolGuidance.js'
import { getPrompt as getAgentToolPrompt } from '../src/tools/AgentTool/prompt.js'
import { getPrompt as getTaskCreatePrompt } from '../src/tools/TaskCreateTool/prompt.js'
import { PROMPT as TODO_WRITE_PROMPT } from '../src/tools/TodoWriteTool/prompt.js'

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
  expect(words).toBeLessThanOrEqual(190)
})

test('canonical task tools receive ordered lifecycle guidance', () => {
  const guidance = getTaskToolGuidance(
    new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'Agent']),
  )

  expect(guidance).toContain('TaskCreate')
  expect(guidance).toContain('TaskUpdate')
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
  expect(source).not.toContain(
    'do not automatically run the full project test suite',
  )
  expect(source).not.toContain(
    'Only run them if the user confirms',
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
  expect(section).toContain('maximum 8')
  expect(section).toContain('dependencies sequential')
  expect(section).toContain('matching result arrives')
  expect(section).toContain('successful result')
  expect(section).toContain('Never emit an empty turn')
  expect(section).not.toContain('--break-system-packages')
  expect(section.split(/\s+/).length).toBeLessThan(180)
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
