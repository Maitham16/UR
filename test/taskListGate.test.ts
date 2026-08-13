import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  TASK_LIST_GATE_DEFAULTS,
  checkTaskListGate,
  countActionableTasksForGate,
  isMutatingTool,
} from '../src/services/tools/taskListGate.ts'
import { AgentTool } from '../src/tools/AgentTool/AgentTool.tsx'
import { EXPLORE_AGENT } from '../src/tools/AgentTool/built-in/exploreAgent.ts'
import { PLAN_AGENT } from '../src/tools/AgentTool/built-in/planAgent.ts'
import {
  areExplorePlanAgentsEnabled,
  getBuiltInAgents,
} from '../src/tools/AgentTool/builtInAgents.ts'
import {
  countToolCallsBeforeCurrent,
  isCurrentPlanFileMutation,
  isReadOnlyBuiltInDelegation,
} from '../src/services/tools/toolExecution.ts'
import {
  isShippedReadOnlyAgentDefinition,
  normalizeReadOnlyResearchDelegation,
  shouldApplyAgentDefinitionPermissionMode,
} from '../src/tools/AgentTool/readOnlyAgents.ts'
import { getPlanFilePath } from '../src/utils/plans.ts'

// The system prompt already asked for a task list on multi-step work and the
// agent still edited files, ran commands and reported completion with no plan
// on record. Guidance does not hold; this is a gate.

const CONFIG = { enabled: true, freeReads: 3 }

test('a mutating call with no task list is refused', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: 0,
    readsSoFar: 10,
    isSubagent: false,
    config: CONFIG,
  })
  expect(decision.allowed).toBe(false)
  // The refusal has to say what to do, or it is just an obstacle.
  expect((decision as { reason: string }).reason).toContain('TaskCreate')
  expect((decision as { reason: string }).reason).toContain(
    'tasks.requireBeforeChanges',
  )
})

test('reads are never blocked, so it can investigate before planning', () => {
  // Demanding a plan before the agent is allowed to look at anything would
  // produce a worse plan, not a better one.
  for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch']) {
    expect(
      checkTaskListGate({
        toolName: tool,
        taskCount: 0,
        readsSoFar: 99,
        isSubagent: false,
        config: CONFIG,
      }).allowed,
    ).toBe(true)
  }
})

test('an existing task list opens the gate', () => {
  expect(
    checkTaskListGate({
      toolName: 'Edit',
      taskCount: 1,
      readsSoFar: 50,
      isSubagent: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('a trivial one-shot edit is not gated', () => {
  // Positive atomic classification is authoritative even after extensive
  // investigation, so one-step work never becomes ceremonial by call count.
  expect(
    checkTaskListGate({
      toolName: 'Edit',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      requiresTaskList: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('classified multi-outcome work is gated before its first mutation', () => {
  const decision = checkTaskListGate({
    toolName: 'Edit',
    taskCount: 0,
    readsSoFar: 0,
    isSubagent: false,
    requiresTaskList: true,
    requirementReason: 'multiple requested outcomes',
    config: CONFIG,
  })
  expect(decision.allowed).toBe(false)
  expect((decision as { reason: string }).reason).toContain(
    'multiple requested outcomes',
  )
})

test('plan-mode recovery distinguishes a plan from visible tasks', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: 0,
    readsSoFar: 0,
    isSubagent: false,
    requiresTaskList: true,
    requirementReason: 'planning workflow',
    config: CONFIG,
  })
  expect(decision.allowed).toBe(false)
  expect((decision as { reason: string }).reason).toContain(
    'plan updates do not create the visible task list',
  )
  expect((decision as { reason: string }).reason).toContain('TaskCreate')
})

test('the active plan artifact and approval transition cannot deadlock on task tracking', () => {
  const planPath = getPlanFilePath()
  const planContext = {
    getAppState: () => ({
      toolPermissionContext: { mode: 'plan' },
    }),
  } as never
  const defaultContext = {
    getAppState: () => ({
      toolPermissionContext: { mode: 'default' },
    }),
  } as never

  expect(
    isCurrentPlanFileMutation(
      'Write',
      { file_path: planPath },
      planContext,
    ),
  ).toBe(true)
  expect(
    isCurrentPlanFileMutation(
      'Edit',
      { file_path: `${planPath}.other` },
      planContext,
    ),
  ).toBe(false)
  expect(
    isCurrentPlanFileMutation(
      'Write',
      { file_path: planPath },
      defaultContext,
    ),
  ).toBe(false)

  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: true,
      requiresTaskList: true,
      isPlanningArtifact: true,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
  expect(
    checkTaskListGate({
      toolName: 'ExitPlanMode',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: true,
      requiresTaskList: true,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('the main session permits only shipped read-only agents before tasks exist', () => {
  const context = {
    options: {
      agentDefinitions: {
        activeAgents: [
          { agentType: 'Explore', source: 'built-in', permissionMode: 'plan' },
          { agentType: 'Plan', source: 'built-in', permissionMode: 'plan' },
          { agentType: 'general-purpose', source: 'built-in' },
        ],
      },
    },
    getAppState: () => ({
      toolPermissionContext: { mode: 'plan' },
    }),
  }

  for (const subagent_type of ['Explore', 'Plan']) {
    for (const mode of ['default', 'plan', 'acceptEdits', 'bypassPermissions']) {
      expect(
        isReadOnlyBuiltInDelegation(
          'Agent',
          { subagent_type, description: 'Read only', prompt: 'Research' },
          {
            ...context,
            getAppState: () => ({ toolPermissionContext: { mode } }),
          } as never,
        ),
      ).toBe(true)
    }
    expect(
      checkTaskListGate({
        toolName: 'Agent',
        taskCount: 0,
        readsSoFar: 0,
        isSubagent: false,
        isMutating: true,
        requiresTaskList: true,
        isReadOnlyBuiltInDelegation: true,
        config: CONFIG,
      }).allowed,
    ).toBe(true)
  }

  expect(EXPLORE_AGENT.permissionMode).toBe('plan')
  expect(PLAN_AGENT.permissionMode).toBe('plan')
  expect(isShippedReadOnlyAgentDefinition(EXPLORE_AGENT)).toBe(true)
  expect(isShippedReadOnlyAgentDefinition(PLAN_AGENT)).toBe(true)
  for (const parentMode of [
    'default',
    'plan',
    'acceptEdits',
    'bypassPermissions',
    'auto',
  ]) {
    expect(
      shouldApplyAgentDefinitionPermissionMode(
        EXPLORE_AGENT,
        parentMode,
        true,
      ),
    ).toBe(true)
  }
  expect(
    shouldApplyAgentDefinitionPermissionMode(
      {
        agentType: 'general-purpose',
        source: 'built-in',
        permissionMode: 'plan',
      },
      'acceptEdits',
      true,
    ),
  ).toBe(false)

  for (const unsafeInput of [
    { subagent_type: 'general-purpose' },
    { subagent_type: 'Explore', name: 'researcher' },
    { subagent_type: 'Explore', team_name: 'research-team' },
    { subagent_type: 'Explore', isolation: 'worktree' },
    {},
  ]) {
    expect(
      isReadOnlyBuiltInDelegation('Agent', unsafeInput, context as never),
    ).toBe(false)
  }

  const customOverrideContext = {
    ...context,
    options: {
      agentDefinitions: {
        activeAgents: [{ agentType: 'Explore', source: 'projectSettings' }],
      },
    },
  }
  expect(
    isReadOnlyBuiltInDelegation(
      'Agent',
      { subagent_type: 'Explore' },
      customOverrideContext as never,
    ),
  ).toBe(false)

  const writableBuiltInContext = {
    ...context,
    options: {
      agentDefinitions: {
        activeAgents: [{ agentType: 'Explore', source: 'built-in' }],
      },
    },
  }
  expect(
    isReadOnlyBuiltInDelegation(
      'Agent',
      { subagent_type: 'Explore' },
      writableBuiltInContext as never,
    ),
  ).toBe(false)

  const nestedContext = { ...context, agentId: 'child-agent' }
  expect(
    isReadOnlyBuiltInDelegation(
      'Agent',
      { subagent_type: 'Explore' },
      nestedContext as never,
    ),
  ).toBe(false)

  // The exception is only for the parent spawn. A child mutation without a
  // parent task remains blocked by the ordinary subagent gate.
  expect(
    checkTaskListGate({
      toolName: 'Bash',
      taskCount: 0,
      readsSoFar: 0,
      isSubagent: true,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
})

test('the public built-in registry always ships the read-only research agents', () => {
  expect(areExplorePlanAgentsEnabled()).toBe(true)
  const builtIns = getBuiltInAgents()

  for (const expected of [EXPLORE_AGENT, PLAN_AGENT]) {
    const active = builtIns.find(agent => agent.agentType === expected.agentType)
    expect(active).toBeDefined()
    expect(active?.source).toBe('built-in')
    expect(active?.permissionMode).toBe('plan')
    expect(active && isShippedReadOnlyAgentDefinition(active)).toBe(true)
  }
})

test('provider-independent read-only research briefs downgrade safely to Explore', () => {
  const agents = [
    { agentType: 'Explore', source: 'built-in', permissionMode: 'plan' },
    { agentType: 'general-purpose', source: 'built-in' },
  ]
  const observedProviderInput = {
    description: 'Research Canvas game architecture',
    subagent_type: 'general-purpose',
    prompt:
      'You are a read-only research agent. Investigate professional Canvas architecture. Do not modify files.',
    run_in_background: true,
  }

  expect(
    normalizeReadOnlyResearchDelegation(
      observedProviderInput,
      agents,
      false,
    ),
  ).toEqual({ ...observedProviderInput, subagent_type: 'Explore' })
  expect(
    normalizeReadOnlyResearchDelegation(
      {
        ...observedProviderInput,
        prompt:
          'This is a RESEARCH task only. Investigate the sources; do not write any code files.',
      },
      agents,
      false,
    ),
  ).toMatchObject({ subagent_type: 'Explore' })

  // Observed provider payload: the caller explicitly requested read-only
  // workers, but the model preserved only a research/report brief in the tool
  // input. Research-only intent is enough because Explore is a strict
  // capability reduction.
  expect(
    normalizeReadOnlyResearchDelegation(
      {
        description: 'Research Canvas game architecture',
        subagent_type: 'general-purpose',
        prompt:
          'Research professional HTML5 Canvas game architecture and performance best practices. Focus on game loops, rendering optimization, and Web Audio. Use available tools and return a concise report with authoritative sources cited.',
      },
      agents,
      false,
    ),
  ).toMatchObject({ subagent_type: 'Explore' })

  for (const unsafe of [
    { ...observedProviderInput, prompt: 'Research and implement the game.' },
    {
      ...observedProviderInput,
      prompt: 'Research the architecture. Then build the complete game.',
    },
    {
      ...observedProviderInput,
      prompt: 'Analyze the bug; fix it and run the tests.',
    },
    { ...observedProviderInput, name: 'researcher' },
    { ...observedProviderInput, team_name: 'research' },
    { ...observedProviderInput, isolation: 'worktree' },
    { ...observedProviderInput, cwd: '/tmp/research' },
  ]) {
    expect(
      normalizeReadOnlyResearchDelegation(unsafe, agents, false),
    ).toBe(unsafe)
  }
  expect(
    normalizeReadOnlyResearchDelegation(
      observedProviderInput,
      agents,
      true,
    ),
  ).toBe(observedProviderInput)
  expect(
    normalizeReadOnlyResearchDelegation(
      observedProviderInput,
      [{ agentType: 'Explore', source: 'project', permissionMode: 'plan' }],
      false,
    ),
  ).toBe(observedProviderInput)
})

test('freeReads zero intentionally gates even atomic work', () => {
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 0,
      isSubagent: false,
      requiresTaskList: false,
      config: { enabled: true, freeReads: 0 },
    }).allowed,
  ).toBe(false)
})

test('subagents must be bound to an actionable parent task before mutation', () => {
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 0,
      isSubagent: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 1,
      readsSoFar: 0,
      isSubagent: true,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('the gate never blocks the fix for itself', () => {
  // If TaskCreate were gated the agent could never satisfy the requirement.
  for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']) {
    expect(isMutatingTool(tool)).toBe(false)
  }
})

test('runtime tool classification covers dynamic and future mutators', () => {
  expect(
    checkTaskListGate({
      toolName: 'mcp__filesystem__move_file',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
  expect(
    checkTaskListGate({
      toolName: 'Bash',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('terminal and internal tasks do not permanently bypass the gate', () => {
  expect(
    countActionableTasksForGate([
      { status: 'completed' },
      { status: 'failed' },
      { status: 'skipped' },
      { status: 'pending', metadata: { _internal: true } },
      {
        status: 'in_progress',
        metadata: { urAutomaticPromptTask: true },
      },
    ]),
  ).toBe(0)
  expect(
    countActionableTasksForGate([
      { status: 'completed' },
      { status: 'pending' },
      { status: 'in_progress' },
    ]),
  ).toBe(2)
})

test('an unreadable task store fails closed for mutations', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: null,
    readsSoFar: 99,
    isSubagent: false,
    isMutating: true,
    config: CONFIG,
  })
  expect(decision.allowed).toBe(false)
  expect((decision as { reason: string }).reason).toContain(
    'could not be read',
  )
})

test('an unreadable task store fails closed even during the free-call allowance', () => {
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: null,
      readsSoFar: 0,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
})

test('delegating to an agent is classified as potentially mutating', () => {
  expect(AgentTool.isReadOnly({} as never)).toBe(false)
  expect(
    checkTaskListGate({
      toolName: 'Agent',
      taskCount: 0,
      readsSoFar: 0,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
})

test('disabling it restores advisory behaviour', () => {
  expect(
    checkTaskListGate({
      toolName: 'Bash',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      config: { enabled: false, freeReads: 0 },
    }).allowed,
  ).toBe(true)
})

test('a tool profile without TaskCreate cannot deadlock on the gate', () => {
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      requiresTaskList: true,
      taskListWriterAvailable: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('the gate ships with strict-hybrid enforcement by default', () => {
  expect(TASK_LIST_GATE_DEFAULTS.enabled).toBe(true)
  expect(TASK_LIST_GATE_DEFAULTS.freeReads).toBeGreaterThan(0)
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      requiresTaskList: false,
      config: TASK_LIST_GATE_DEFAULTS,
    }).allowed,
  ).toBe(true)
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 0,
      isSubagent: false,
      requiresTaskList: true,
      config: TASK_LIST_GATE_DEFAULTS,
    }).allowed,
  ).toBe(false)
})

test('the allowance counts tool calls, not conversation length', () => {
  // Shipped counting messages, so any back-and-forth exhausted the allowance
  // and the gate blocked the first Write of a one-file request — the case the
  // allowance exists to let through.
  const source = readFileSync('src/services/tools/toolExecution.ts', 'utf8')
  const call = source.slice(source.indexOf('checkTaskListGate({'))
  expect(call.slice(0, 400)).toContain('countToolCalls')
  expect(call.slice(0, 400)).not.toContain('messages?.length')
})

test('countToolCalls ignores plain conversation', () => {
  const assistantMessage = {
    type: 'assistant',
    message: { id: 'current', content: [] },
  } as never
  expect(
    countToolCallsBeforeCurrent(
      [
        { type: 'user', message: { content: 'hello' } },
        {
          type: 'assistant',
          message: { id: 'earlier', content: [{ type: 'text', text: 'hi' }] },
        },
      ],
      assistantMessage,
      'not-present',
    ),
  ).toBe(0)
})

test('parallel calls in one response consume the allowance by ordinal', () => {
  const blocks = Array.from({ length: 4 }, (_, index) => ({
    type: 'tool_use' as const,
    id: `mutation-${index}`,
    name: 'Write',
    input: {},
  }))
  const assistantMessage = {
    type: 'assistant',
    message: { id: 'current-batch', content: blocks },
  } as never
  const counts = blocks.map(block =>
    countToolCallsBeforeCurrent([], assistantMessage, block.id),
  )
  expect(counts).toEqual([0, 1, 2, 3])
  expect(
    blocks.map(block =>
      countToolCallsBeforeCurrent(
        [assistantMessage],
        assistantMessage,
        block.id,
      ),
    ),
  ).toEqual([0, 1, 2, 3])
  expect(
    counts.map(
      readsSoFar =>
        checkTaskListGate({
          toolName: 'Write',
          taskCount: 0,
          readsSoFar,
          isSubagent: false,
          isMutating: true,
          config: CONFIG,
        }).allowed,
    ),
  ).toEqual([true, true, true, false])
})

test('an unreadable task directory cannot silently open the mutation gate', () => {
  const source = readFileSync(
    'src/services/tools/toolExecution.ts',
    'utf8',
  )
  const fn = source.slice(source.indexOf('async function countTasksForGate'))
  expect(fn.slice(0, 400)).toContain('return null')
  expect(fn.slice(0, 400)).not.toContain('POSITIVE_INFINITY')
})
