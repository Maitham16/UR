import { afterEach, beforeEach, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  getIsInteractive,
  getSessionId,
  setIsInteractive,
} from '../src/bootstrap/state.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import { runToolUse } from '../src/services/tools/toolExecution.js'

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

test('a permission rewrite from read-only to mutating is revalidated and gated', async () => {
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
      tools: [tool],
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

  expect(callCount).toBe(0)
  expect(JSON.stringify(output)).toContain(
    'TaskListRequired after input update',
  )
})

test('a headless TodoWrite plan satisfies the final mutation gate', async () => {
  const previousInteractive = getIsInteractive()
  setIsInteractive(false)
  let callCount = 0
  try {
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
        return { data: 'executed with a legacy plan' }
      },
    }
    const state = getDefaultAppState()
    state.todos[getSessionId()] = [
      {
        content: 'Apply the approved edit',
        activeForm: 'Applying the approved edit',
        status: 'in_progress',
      },
    ]
    const context = {
      abortController: new AbortController(),
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'test-model',
        tools: [tool],
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      getAppState: () => state,
      setAppState: () => {},
      messages: [],
      readFileState: new Map(),
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    }
    const assistantMessage = {
      type: 'assistant',
      uuid: 'assistant-legacy-plan-gate',
      message: {
        id: 'message-legacy-plan-gate',
        content: [],
      },
    }
    const output = await Array.fromAsync(
      runToolUse(
        {
          type: 'tool_use',
          id: 'legacy-plan-mutation',
          name: 'ConditionalMutation',
          input: { action: 'read' },
        } as never,
        assistantMessage as never,
        (async () => ({
          behavior: 'allow' as const,
          updatedInput: { action: 'write' as const },
        })) as never,
        context as never,
      ),
    )

    expect(callCount).toBe(1)
    expect(JSON.stringify(output)).not.toContain('TaskListRequired')
  } finally {
    setIsInteractive(previousInteractive)
  }
})
