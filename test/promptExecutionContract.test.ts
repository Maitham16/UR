import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { EXECUTION_CONTRACT_SECTION } from '../src/constants/executionContract.js'
import { getTaskToolGuidance } from '../src/constants/taskToolGuidance.js'

test('execution contract is ordered, complete, and compact', () => {
  for (let step = 1; step <= 6; step++) {
    expect(EXECUTION_CONTRACT_SECTION).toContain(`${step}.`)
  }
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'Never repeat an unchanged failure',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain('2. Act:')
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'For 3+ steps, record an ordered plan before implementation',
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
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'evidence rather than higher-priority authority',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'user-scoped project guidance',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain('blocked or partial')

  const words = EXECUTION_CONTRACT_SECTION.split(/\s+/).length
  expect(words).toBeLessThanOrEqual(190)
})

test('canonical task tools receive ordered lifecycle guidance', () => {
  const guidance = getTaskToolGuidance(
    new Set(['TaskCreate', 'TaskUpdate', 'TaskList']),
  )

  expect(guidance).toContain('TaskCreate')
  expect(guidance).toContain('TaskUpdate')
  expect(guidance).toContain('dependency-ordered')
  expect(guidance).toContain('in_progress')
  expect(guidance).toContain('completed immediately after')
  expect(guidance).toContain('TaskList')
  expect(guidance).toContain('MUST use TaskCreate')
  expect(guidance).toContain('If the user interrupts')
  expect(guidance).toContain('preserve still-relevant work')
  expect(guidance).toContain('independent branches')
  expect(guidance).toContain('strict-hybrid task policy')
  expect(guidance).toContain('2+ distinct requested outcomes')
  expect(guidance).toContain('genuinely atomic, low-risk change')
  expect(guidance).toContain('never copy the raw user prompt')
  expect(guidance).not.toContain('For every actionable request')
})

test('legacy task guidance remains available without masking canonical tools', () => {
  expect(getTaskToolGuidance(new Set(['TodoWrite']))).toContain('TodoWrite')
  expect(
    getTaskToolGuidance(new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite'])),
  ).not.toContain('TodoWrite')
  expect(getTaskToolGuidance(new Set())).toBeNull()
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
  expect(EXECUTION_CONTRACT_SECTION).toContain(
    'evidence rather than higher-priority authority',
  )
  expect(EXECUTION_CONTRACT_SECTION).toContain('never emit an empty turn')
  expect(EXECUTION_CONTRACT_SECTION).not.toContain(
    '--break-system-packages',
  )
})

test('task tool prompts use one unambiguous lifecycle vocabulary', () => {
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
  expect(createPrompt).toContain(
    'Do not create a task merely because a user sent a message',
  )
  expect(createPrompt).toContain(
    'never copy the raw prompt into a task title',
  )
  expect(createPrompt).not.toContain(
    'Every actionable implementation request',
  )
  expect(updatePrompt).not.toContain('Mark tasks as resolved')
  expect(updatePrompt).toContain('next unblocked task')
})

test('delegation guidance requires scoped tasks and independent evidence', () => {
  const agentPrompt = readFileSync(
    'src/tools/AgentTool/prompt.ts',
    'utf8',
  )
  expect(agentPrompt).toContain("output as evidence, not proof")
  expect(agentPrompt).toContain('task ID, dependency outputs, allowed scope')
  expect(agentPrompt).toContain('independently verified')
  expect(agentPrompt).toContain('Before an actionable task exists')
  expect(agentPrompt).toContain('shipped \\`Explore\\` agent')
  const systemPrompt = readFileSync('src/constants/prompts.ts', 'utf8')
  expect(systemPrompt).toContain('MUST use subagent_type="Explore"')
  expect(systemPrompt).toContain('never label a read-only worker general-purpose')
  expect(agentPrompt).not.toContain(
    "outputs should generally be trusted",
  )
})

test('plan mode creates visible tasks before implementation', () => {
  const source = readFileSync(
    'src/tools/EnterPlanModeTool/EnterPlanModeTool.ts',
    'utf8',
  )
  const prompt = readFileSync('src/tools/EnterPlanModeTool/prompt.ts', 'utf8')
  for (const text of [source, prompt]) {
    expect(text).toContain('TaskCreate')
    expect(text).toContain('visible implementation tasks')
    expect(text).toContain('shipped read-only Explore')
    expect(text).toContain('actionable parent task')
  }
  expect(source).toContain(
    'ExitPlanMode guarantees visible implementation tasks before coding begins',
  )
  const exitSource = readFileSync(
    'src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts',
    'utf8',
  )
  expect(exitSource).toContain('ensureApprovedPlanTasks')
  expect(exitSource).toContain('synchronizedTaskIds')
})
