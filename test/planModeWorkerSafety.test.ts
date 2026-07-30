import { expect, test } from 'bun:test'
import {
  getIsInteractive,
  setIsInteractive,
} from '../src/bootstrap/state.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import {
  isBuiltInReadOnlyPlanningSubagent,
  isReadOnlyPlanAgentDelegation,
} from '../src/services/tools/toolExecution.js'
import { resolveAgentTools } from '../src/tools/AgentTool/agentToolUtils.js'
import { EXPLORE_AGENT } from '../src/tools/AgentTool/built-in/exploreAgent.js'
import { PLAN_AGENT } from '../src/tools/AgentTool/built-in/planAgent.js'
import {
  areExplorePlanAgentsEnabled,
  getBuiltInAgents,
} from '../src/tools/AgentTool/builtInAgents.js'
import { TeamCreateTool } from '../src/tools/TeamCreateTool/TeamCreateTool.js'
import { TeamDeleteTool } from '../src/tools/TeamDeleteTool/TeamDeleteTool.js'
import {
  getAvailableReadOnlyPlanAgentTypes,
} from '../src/utils/attachments.js'
import { normalizeAttachmentForAPI } from '../src/utils/messages.js'

function makePlanContext(activeAgents = getBuiltInAgents()) {
  const state = getDefaultAppState()
  state.toolPermissionContext = {
    ...state.toolPermissionContext,
    mode: 'plan',
  }
  return {
    state,
    context: {
      getAppState: () => state,
      options: {
        tools: [{ name: 'Agent' }],
        agentDefinitions: {
          activeAgents,
          allAgents: activeAgents,
          allowedAgentTypes: undefined as string[] | undefined,
        },
      },
    },
  }
}

test('standard builds register the read-only Explore and Plan agents', () => {
  const builtIns = getBuiltInAgents()
  const names = builtIns.map(agent => agent.agentType)

  expect(areExplorePlanAgentsEnabled()).toBe(true)
  expect(names).toContain(EXPLORE_AGENT.agentType)
  expect(names).toContain(PLAN_AGENT.agentType)

  for (const agent of [EXPLORE_AGENT, PLAN_AGENT]) {
    expect(agent.source).toBe('built-in')
    expect(agent.permissionMode).toBe('dontAsk')
    expect(agent.tools).toEqual(['Glob', 'Grep', 'Read'])
    expect(agent.disallowedTools).toEqual(
      expect.arrayContaining(['Agent', 'ExitPlanMode', 'Edit', 'Write']),
    )
  }
})

test('planning workers resolve to a narrow pool without task or workspace tools', () => {
  const available = [
    'Bash',
    'Glob',
    'Grep',
    'Read',
    'Write',
    'Edit',
    'TaskCreate',
    'TaskUpdate',
    'TeamCreate',
    'TeamDelete',
    'EnterWorktree',
    'Computer',
    'Api',
  ].map(name => ({ name }))

  for (const agent of [EXPLORE_AGENT, PLAN_AGENT]) {
    const resolved = resolveAgentTools(
      agent,
      available as never,
    ).resolvedTools.map(tool => tool.name)
    expect(resolved).toEqual(['Glob', 'Grep', 'Read'])
  }
})

test('plan-mode gate exemption accepts only exact foreground read-only built-ins', () => {
  const { state, context } = makePlanContext()
  const agentTool = { name: 'Agent', aliases: ['Task'] }
  const baseInput = {
    description: 'Inspect implementation',
    prompt: 'Read the relevant code and report evidence.',
  }

  expect(
    isReadOnlyPlanAgentDelegation(
      agentTool,
      { ...baseInput, subagent_type: 'Explore' },
      context as never,
    ),
  ).toBe(true)
  expect(
    isReadOnlyPlanAgentDelegation(
      agentTool,
      { ...baseInput, subagent_type: 'Plan', run_in_background: false },
      context as never,
    ),
  ).toBe(true)

  for (const input of [
    { ...baseInput, subagent_type: 'general-purpose' },
    { ...baseInput, subagent_type: 'Explore', name: 'researcher' },
    { ...baseInput, subagent_type: 'Explore', team_name: 'planning' },
    { ...baseInput, subagent_type: 'Explore', run_in_background: true },
    { ...baseInput, subagent_type: 'Explore', isolation: 'worktree' },
    { ...baseInput, subagent_type: 'Explore', cwd: '/tmp' },
  ]) {
    expect(
      isReadOnlyPlanAgentDelegation(agentTool, input, context as never),
    ).toBe(false)
  }

  const customExplore = {
    ...EXPLORE_AGENT,
    source: 'projectSettings',
    baseDir: '/project/.ur/agents',
  }
  const customContext = makePlanContext([customExplore as never]).context
  expect(
    isReadOnlyPlanAgentDelegation(
      agentTool,
      { ...baseInput, subagent_type: 'Explore' },
      customContext as never,
    ),
  ).toBe(false)

  state.toolPermissionContext = {
    ...state.toolPermissionContext,
    mode: 'default',
  }
  expect(
    isReadOnlyPlanAgentDelegation(
      agentTool,
      { ...baseInput, subagent_type: 'Explore' },
      context as never,
    ),
  ).toBe(false)
})

test('plan attachments advertise only active built-in planning workers', () => {
  const { state, context } = makePlanContext()
  expect(getAvailableReadOnlyPlanAgentTypes(context as never)).toEqual([
    'Explore',
    'Plan',
  ])

  context.options.agentDefinitions.allowedAgentTypes = ['Explore']
  expect(getAvailableReadOnlyPlanAgentTypes(context as never)).toEqual([
    'Explore',
  ])

  context.options.agentDefinitions.allowedAgentTypes = undefined
  state.toolPermissionContext = {
    ...state.toolPermissionContext,
    alwaysDenyRules: {
      ...state.toolPermissionContext.alwaysDenyRules,
      session: ['Agent(Plan)'],
    },
  }
  expect(getAvailableReadOnlyPlanAgentTypes(context as never)).toEqual([
    'Explore',
  ])

  const noWorkers = normalizeAttachmentForAPI({
    type: 'plan_mode',
    reminderType: 'full',
    planFilePath: '/tmp/plan.md',
    planExists: false,
    availablePlanAgentTypes: [],
  })
  const noWorkerPrompt = JSON.stringify(noWorkers)
  expect(noWorkerPrompt).toContain(
    'read-only tools that are actually available',
  )
  expect(noWorkerPrompt).toContain(
    'Do not call a generic Agent as a planning fallback',
  )
  expect(noWorkerPrompt).not.toContain('Launch up to 3 Explore')
  expect(noWorkerPrompt).not.toContain('Launch Plan agent')
})

test('SDK built-in opt-out is reflected by registration and advertising', () => {
  const previousInteractive = getIsInteractive()
  const previousDisable = process.env.UR_AGENT_SDK_DISABLE_BUILTIN_AGENTS
  try {
    setIsInteractive(false)
    process.env.UR_AGENT_SDK_DISABLE_BUILTIN_AGENTS = '1'
    expect(areExplorePlanAgentsEnabled()).toBe(false)
    expect(getBuiltInAgents()).toEqual([])
  } finally {
    setIsInteractive(previousInteractive)
    if (previousDisable === undefined) {
      delete process.env.UR_AGENT_SDK_DISABLE_BUILTIN_AGENTS
    } else {
      process.env.UR_AGENT_SDK_DISABLE_BUILTIN_AGENTS = previousDisable
    }
  }
})

test('planning child identity is restricted to an active built-in definition', () => {
  const activeAgents = getBuiltInAgents()
  const base = {
    agentId: 'planning-child',
    agentType: 'Explore',
    options: {
      agentDefinitions: { activeAgents, allAgents: activeAgents },
    },
  }
  expect(isBuiltInReadOnlyPlanningSubagent(base as never)).toBe(true)
  expect(
    isBuiltInReadOnlyPlanningSubagent({
      ...base,
      agentId: undefined,
    } as never),
  ).toBe(false)
  expect(
    isBuiltInReadOnlyPlanningSubagent({
      ...base,
      options: {
        agentDefinitions: {
          activeAgents: [
            { ...EXPLORE_AGENT, source: 'projectSettings' } as never,
          ],
          allAgents: [],
        },
      },
    } as never),
  ).toBe(false)
})

test('team lifecycle mutations fail closed across a mode transition', async () => {
  const { state, context } = makePlanContext()

  expect(
    await TeamCreateTool.validateInput?.(
      { team_name: 'implementation' },
      context as never,
    ),
  ).toEqual(
    expect.objectContaining({
      result: false,
      message: expect.stringContaining('unavailable in plan mode'),
    }),
  )
  expect(
    await TeamDeleteTool.validateInput?.({}, context as never),
  ).toEqual(
    expect.objectContaining({
      result: false,
      message: expect.stringContaining('unavailable in plan mode'),
    }),
  )

  state.toolPermissionContext = {
    ...state.toolPermissionContext,
    mode: 'default',
  }
  expect(
    await TeamCreateTool.validateInput?.(
      { team_name: 'implementation' },
      context as never,
    ),
  ).toEqual({ result: true })
  expect(
    await TeamDeleteTool.validateInput?.({}, context as never),
  ).toEqual({ result: true })

  // Validation can happen before an async permission phase. The call itself
  // must re-read live mode so an unchanged input cannot cross default→plan.
  state.toolPermissionContext = {
    ...state.toolPermissionContext,
    mode: 'plan',
  }
  await expect(
    TeamCreateTool.call(
      { team_name: 'must-not-exist' },
      context as never,
      undefined as never,
      undefined as never,
    ),
  ).rejects.toThrow('unavailable in plan mode')
  await expect(
    TeamDeleteTool.call(
      {},
      context as never,
      undefined as never,
      undefined as never,
    ),
  ).rejects.toThrow('unavailable in plan mode')
})
