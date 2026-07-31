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

  // The gate ships disabled, so the revalidated call now executes. What must
  // still hold is that the rewrite was re-classified as mutating rather than
  // trusted as the read-only call it arrived as.
  expect(callCount).toBe(1)
  expect(JSON.stringify(output)).not.toContain(
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
