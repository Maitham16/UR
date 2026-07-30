import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  getApprovedPlanCapabilities,
  getApprovedPlanImplementationInstruction,
  PLAN_TASK_GRAPH_REQUIREMENT,
} from '../src/constants/planImplementationContract.js'
import { WORKER_AGENT } from '../src/tools/AgentTool/built-in/generalPurposeAgent.js'
import { PLAN_AGENT } from '../src/tools/AgentTool/built-in/planAgent.js'
import { ExitPlanModeV2Tool } from '../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { PLAN_PHASE4_CONTROL } from '../src/utils/messages.js'

test('approved plans become complete task graphs before implementation', () => {
  const instruction = getApprovedPlanImplementationInstruction({
    taskTool: 'task-v2',
    implementationAgentType: 'worker',
  })

  expect(instruction).toContain('Before changing the workspace')
  expect(instruction).toContain(
    'Your next state-changing calls MUST be TaskCreate only',
  )
  expect(instruction).toContain(
    'Do not call Write, Edit, a mutating shell, Agent, Task, or any other state-changing implementation tool yet',
  )
  expect(instruction).toContain(
    'do not batch task setup with implementation',
  )
  expect(instruction).toContain('one TaskCreate call per cohesive')
  expect(instruction).toContain('one umbrella task does not satisfy')
  expect(instruction).toContain('independent TaskCreate calls together')
  expect(instruction).toContain('use TaskUpdate to add dependencies')
  expect(instruction).toContain(
    'mark the selected serial task or tasks actually launching in the current worker wave in_progress',
  )
  expect(instruction).toContain(
    'Inspect those successful results before implementation',
  )
  expect(instruction.indexOf('TaskCreate')).toBeLessThan(
    instruction.indexOf('Write'),
  )
  expect(instruction.indexOf('TaskUpdate')).toBeLessThan(
    instruction.indexOf('After the graph is complete'),
  )
  expect(instruction).toContain('launch up to 8 ready tasks')
  expect(instruction).toContain('per parallel wave')
  expect(instruction).toContain('continue with later waves as slots free')
  expect(instruction).toContain('no conflicting shared mutation')
  expect(instruction).toContain(
    'through Agent using subagent_type=worker',
  )
  expect(instruction).toContain(
    'Keep dependent tasks and conflicting shared writes sequential',
  )
  expect(instruction).toContain('independently verify worker results')
})

test('approved-plan handoff does not invent an unavailable worker tool', () => {
  const instruction = getApprovedPlanImplementationInstruction({
    taskTool: 'task-v2',
  })

  expect(instruction).toContain('execute ready tasks in dependency order')
  expect(instruction).not.toContain('through Agent')
})

test('approved-plan handoff follows the actual task and worker capabilities', () => {
  const headless = {
    options: {
      tools: [{ name: 'Agent' }, { name: 'TodoWrite' }],
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
  }
  const headlessCapabilities = getApprovedPlanCapabilities(headless as never)
  expect(headlessCapabilities).toEqual({ taskTool: 'todo-write' })

  const headlessInstruction = getApprovedPlanImplementationInstruction(
    headlessCapabilities,
  )
  expect(headlessInstruction).toContain('Use TodoWrite')
  expect(headlessInstruction).toContain(
    'Your next state-changing call MUST be TodoWrite',
  )
  expect(headlessInstruction).toContain(
    'do not batch todo setup with implementation',
  )
  expect(headlessInstruction).not.toContain('TaskCreate')
  expect(headlessInstruction).not.toContain('TaskUpdate')
  expect(headlessInstruction).not.toContain('through Agent')

  const standard = {
    options: {
      tools: [
        { name: 'TaskCreate' },
        { name: 'TaskUpdate' },
        { name: 'Agent', aliases: ['Task'] },
      ],
      agentDefinitions: {
        activeAgents: [WORKER_AGENT],
        allAgents: [WORKER_AGENT],
      },
    },
  }
  expect(getApprovedPlanCapabilities(standard as never)).toEqual({
    taskTool: 'task-v2',
    implementationAgentType: 'worker',
  })

  for (const partial of [
    [{ name: 'TaskCreate' }, { name: 'TodoWrite' }],
    [{ name: 'TaskUpdate' }, { name: 'TodoWrite' }],
  ]) {
    expect(
      getApprovedPlanCapabilities({
        options: {
          tools: partial,
          agentDefinitions: { activeAgents: [], allAgents: [] },
        },
      } as never),
    ).toEqual({ taskTool: 'todo-write' })
  }

  const noTracking = getApprovedPlanImplementationInstruction({
    taskTool: 'none',
  })
  expect(noTracking).toContain('numbered Implementation Tasks')
  expect(noTracking).not.toContain('TaskCreate')
  expect(noTracking).not.toContain('TodoWrite')
})

test('every plan workflow requires independently verifiable execution tasks', () => {
  expect(PLAN_TASK_GRAPH_REQUIREMENT).toContain(
    'one numbered task per cohesive, independently verifiable outcome',
  )
  expect(PLAN_TASK_GRAPH_REQUIREMENT).toContain('one umbrella task')
  expect(PLAN_TASK_GRAPH_REQUIREMENT).toContain('file/tool-call micro-tasks')
  expect(PLAN_TASK_GRAPH_REQUIREMENT).toContain('parallel worker wave')
  expect(PLAN_PHASE4_CONTROL).toContain(PLAN_TASK_GRAPH_REQUIREMENT)

  const messagesSource = readFileSync('src/utils/messages.ts', 'utf8')
  expect(
    messagesSource.match(/\$\{PLAN_TASK_GRAPH_REQUIREMENT\}/g)?.length,
  ).toBe(5)
})

test('built-in Plan agent returns the same executable task structure', () => {
  const prompt = PLAN_AGENT.getSystemPrompt({} as never)

  expect(prompt).toContain('Implementation Tasks')
  expect(prompt).toContain(PLAN_TASK_GRAPH_REQUIREMENT)
})

test('keep-context plan approval gives the model an enforceable worker handoff', () => {
  const result = ExitPlanModeV2Tool.mapToolResultToToolResultBlockParam(
    {
      plan: '# Plan\n\n1. Fix parser\n2. Add tests',
      isAgent: false,
      filePath: '/tmp/plan.md',
      implementationTaskTool: 'task-v2',
      implementationAgentType: 'worker',
    },
    'exit-plan',
  )
  const content = typeof result.content === 'string' ? result.content : ''

  expect(content).toContain('one TaskCreate call per cohesive')
  expect(content).toContain(
    'Your next state-changing calls MUST be TaskCreate only',
  )
  expect(content).toContain(
    'mark the selected serial task or tasks actually launching in the current worker wave in_progress',
  )
  expect(content).toContain(
    'Inspect those successful results before implementation',
  )
  expect(content).toContain('through Agent using subagent_type=worker')
  expect(content).not.toContain('consider using the TeamCreate tool')

  const source = readFileSync(
    'src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts',
    'utf8',
  )
  expect(source).toContain('getApprovedPlanCapabilities(context)')
  expect(source).not.toContain('isAgentSwarmsEnabled() &&')
})

test('keep-context TodoWrite approval names only the available tracker', () => {
  const result = ExitPlanModeV2Tool.mapToolResultToToolResultBlockParam(
    {
      plan: '# Plan\n\n1. Fix parser\n2. Add tests',
      isAgent: false,
      filePath: '/tmp/plan.md',
      implementationTaskTool: 'todo-write',
    },
    'exit-plan-todo',
  )
  const content = typeof result.content === 'string' ? result.content : ''

  expect(content).toContain(
    'Your next state-changing call MUST be TodoWrite',
  )
  expect(content).toContain(
    'Inspect the successful TodoWrite result before implementation',
  )
  expect(content).not.toContain('TaskCreate')
  expect(content).not.toContain('TaskUpdate')
})

test('clear-context plan approval reuses the same implementation contract', () => {
  const source = readFileSync(
    'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
    'utf8',
  )

  expect(source).toContain('getApprovedPlanImplementationInstruction')
  expect(source).toContain('getApprovedPlanCapabilities')
  expect(source).not.toContain(
    'getApprovedPlanImplementationInstruction(isAgentSwarmsEnabled())',
  )
  expect(source).not.toContain('consider using the ${TEAM_CREATE_TOOL_NAME}')
})
