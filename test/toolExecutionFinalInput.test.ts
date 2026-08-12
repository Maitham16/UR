import { afterEach, beforeEach, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import { runToolUse } from '../src/services/tools/toolExecution.js'
import { checkTaskListGate } from '../src/services/tools/taskListGate.js'

const originalTaskListId = process.env.UR_CODE_TASK_LIST_ID

beforeEach(() => {
  process.env.UR_CODE_TASK_LIST_ID =
    'tool-execution-final-input-gate-regression'
})

afterEach(() => {
  if (originalTaskListId === undefined) {
    delete process.env.UR_CODE_TASK_LIST_ID
  } else {
    process.env.UR_CODE_TASK_LIST_ID = originalTaskListId
  }
})

test('a permission rewrite from read-only to mutating is revalidated', async () => {
  let callCount = 0
  const tool = {
    name: 'ConditionalMutation',
    inputSchema: z.strictObject({
      action: z.enum(['read', 'write']),
    }),
    isReadOnly: (input: { action: 'read' | 'write' }) =>
      input.action === 'read',
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    async call() {
      callCount++
      return { data: 'must not execute' }
    },
  }
  const priorCalls = Array.from({ length: 3 }, (_, index) => ({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: `prior-${index}`,
          name: 'Read',
          input: {},
        },
      ],
    },
  }))
  const context = {
    abortController: new AbortController(),
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools: [tool, { name: 'TaskCreate' }],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    getAppState: () => getDefaultAppState(),
    setAppState: () => {},
    messages: priorCalls,
    readFileState: new Map(),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  }
  const assistantMessage = {
    type: 'assistant',
    uuid: 'assistant-final-input-gate',
    message: {
      id: 'message-final-input-gate',
      content: [],
    },
  }
  const toolUse = {
    type: 'tool_use',
    id: 'conditional-mutation-use',
    name: 'ConditionalMutation',
    input: { action: 'read' },
  }
  const allowWithMutatingRewrite = async () => ({
    behavior: 'allow' as const,
    updatedInput: { action: 'write' as const },
  })

  const output = await Array.fromAsync(
    runToolUse(
      toolUse as never,
      assistantMessage as never,
      allowWithMutatingRewrite as never,
      context as never,
    ),
  )

  // The strict-hybrid gate ships enabled. Because this legacy-style context
  // has no user-turn classification and exhausted its compatibility
  // allowance, the mutating rewrite must be blocked before execution.
  expect(callCount).toBe(0)
  expect(JSON.stringify(output)).toContain(
    'TaskListRequired after input update',
  )
  expect(
    checkTaskListGate({
      toolName: 'ConditionalMutation',
      taskCount: 0,
      readsSoFar: 3,
      isSubagent: false,
      isMutating: true,
      config: { enabled: true, freeReads: 3 },
    }).allowed,
  ).toBe(false)
})

test('a permission rewrite cannot turn plan exploration into untracked general delegation', async () => {
  let callCount = 0
  const tool = {
    name: 'Agent',
    inputSchema: z.strictObject({
      subagent_type: z.string(),
    }),
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    async call() {
      callCount++
      return { data: 'must not execute' }
    },
  }
  const priorCalls = Array.from({ length: 3 }, (_, index) => ({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: `prior-agent-${index}`,
          name: 'Read',
          input: {},
        },
      ],
    },
  }))
  const appState = {
    ...getDefaultAppState(),
    toolPermissionContext: {
      ...getDefaultAppState().toolPermissionContext,
      mode: 'plan' as const,
    },
  }
  const context = {
    abortController: new AbortController(),
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools: [tool, { name: 'TaskCreate' }],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: {
        activeAgents: [
          {
            agentType: 'Explore',
            source: 'built-in',
            permissionMode: 'plan',
          },
        ],
        allAgents: [],
      },
    },
    getAppState: () => appState,
    setAppState: () => {},
    messages: priorCalls,
    readFileState: new Map(),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  }
  const assistantMessage = {
    type: 'assistant',
    uuid: 'assistant-plan-agent-rewrite',
    message: {
      id: 'message-plan-agent-rewrite',
      content: [],
    },
  }
  const output = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'plan-agent-rewrite-use',
        name: 'Agent',
        input: { subagent_type: 'Explore' },
      } as never,
      assistantMessage as never,
      (async () => ({
        behavior: 'allow' as const,
        updatedInput: { subagent_type: 'general-purpose' },
      })) as never,
      context as never,
    ),
  )

  expect(callCount).toBe(0)
  expect(JSON.stringify(output)).toContain(
    'TaskListRequired after input update',
  )
})
