import { afterEach, beforeEach, expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { z } from 'zod/v4'
import {
  getIsInteractive,
  getSessionId,
  setIsInteractive,
} from '../src/bootstrap/state.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import { runToolUse } from '../src/services/tools/toolExecution.js'
import { EXPLORE_AGENT } from '../src/tools/AgentTool/built-in/exploreAgent.js'
import { getPlanFilePath } from '../src/utils/plans.js'

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

test('plan mode runs a foreground built-in Explore call but gates a rewrite to a generic agent', async () => {
  let callCount = 0
  const tool = {
    name: 'Agent',
    aliases: ['Task'],
    inputSchema: z.strictObject({
      description: z.string(),
      prompt: z.string(),
      subagent_type: z.string(),
    }),
    isReadOnly: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    async call() {
      callCount++
      return { data: 'read-only planning evidence' }
    },
    mapToolResultToToolResultBlockParam(data: string, toolUseID: string) {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: [{ type: 'text' as const, text: data }],
      }
    },
  }
  const state = getDefaultAppState()
  state.toolPermissionContext = {
    ...state.toolPermissionContext,
    mode: 'plan',
  }
  const priorCalls = Array.from({ length: 3 }, (_, index) => ({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: `plan-prior-${index}`,
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
      agentDefinitions: {
        activeAgents: [EXPLORE_AGENT],
        allAgents: [EXPLORE_AGENT],
      },
    },
    getAppState: () => state,
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
    uuid: 'assistant-plan-explore-gate',
    message: {
      id: 'message-plan-explore-gate',
      content: [],
    },
  }
  const input = {
    description: 'Inspect the implementation',
    prompt: 'Collect read-only evidence for the plan.',
    subagent_type: 'Explore',
  }

  const allowedOutput = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'plan-explore-use',
        name: 'Agent',
        input,
      } as never,
      assistantMessage as never,
      (async () => ({
        behavior: 'allow' as const,
        updatedInput: input,
      })) as never,
      context as never,
    ),
  )

  expect(callCount).toBe(1)
  expect(JSON.stringify(allowedOutput)).toContain('read-only planning evidence')

  const rewrittenOutput = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'plan-agent-rewrite-use',
        name: 'Agent',
        input: {
          ...input,
          prompt: 'This call is rewritten after initial validation.',
        },
      } as never,
      assistantMessage as never,
      (async (_tool, originalInput) => ({
        behavior: 'allow' as const,
        updatedInput: {
          ...originalInput,
          subagent_type: 'general-purpose',
        },
      })) as never,
      context as never,
    ),
  )

  expect(callCount).toBe(1)
  expect(JSON.stringify(rewrittenOutput)).toContain(
    'TaskListRequired after input update',
  )
})

test('a built-in planning child cannot mutate even with an actionable task or hook rewrite', async () => {
  const previousInteractive = getIsInteractive()
  const previousTaskV2 = process.env.UR_CODE_ENABLE_TASKS
  setIsInteractive(false)
  delete process.env.UR_CODE_ENABLE_TASKS
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
        return { data: 'must not execute' }
      },
    }
    const state = getDefaultAppState()
    state.todos['read-only-planning-child'] = [
      {
        content: 'Existing actionable task must not open this boundary',
        activeForm: 'Testing boundary',
        status: 'in_progress',
      },
    ]
    const context = {
      abortController: new AbortController(),
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'test-model',
        tools: [tool, { name: 'TodoWrite' }],
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: {
          activeAgents: [EXPLORE_AGENT],
          allAgents: [EXPLORE_AGENT],
        },
      },
      agentId: 'read-only-planning-child',
      agentType: 'Explore',
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
      uuid: 'assistant-read-only-planning-child',
      message: {
        id: 'message-read-only-planning-child',
        content: [],
      },
    }

    const directMutation = await Array.fromAsync(
      runToolUse(
        {
          type: 'tool_use',
          id: 'planning-child-direct-write',
          name: 'ConditionalMutation',
          input: { action: 'write' },
        } as never,
        assistantMessage as never,
        (async (_tool, input) => ({
          behavior: 'allow' as const,
          updatedInput: input,
        })) as never,
        context as never,
      ),
    )
    expect(callCount).toBe(0)
    expect(JSON.stringify(directMutation)).toContain(
      'ReadOnlyPlanningAgent',
    )
    expect(JSON.stringify(directMutation)).not.toContain('TaskListRequired')

    const rewrittenMutation = await Array.fromAsync(
      runToolUse(
        {
          type: 'tool_use',
          id: 'planning-child-rewritten-write',
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
    expect(callCount).toBe(0)
    expect(JSON.stringify(rewrittenMutation)).toContain(
      'ReadOnlyPlanningAgent after input update',
    )
  } finally {
    setIsInteractive(previousInteractive)
    if (previousTaskV2 === undefined) {
      delete process.env.UR_CODE_ENABLE_TASKS
    } else {
      process.env.UR_CODE_ENABLE_TASKS = previousTaskV2
    }
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

test('loopback open reaches Bash permission but a mutating rewrite is task-gated', async () => {
  let callCount = 0
  let permissionCount = 0
  const tool = {
    name: 'Bash',
    inputSchema: z.strictObject({ command: z.string() }),
    // App launch remains permission-relevant even though the narrow loopback
    // preview does not require an unfinished workspace task.
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    async call() {
      callCount++
      return { data: 'preview launched' }
    },
  }
  const priorCalls = Array.from({ length: 3 }, (_, index) => ({
    type: 'assistant',
    message: {
      id: `preview-prior-message-${index}`,
      content: [
        {
          type: 'tool_use',
          id: `preview-prior-${index}`,
          name: 'Read',
          input: {},
        },
      ],
    },
  }))
  const state = getDefaultAppState()
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
    messages: priorCalls,
    readFileState: new Map(),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  }
  const previewInput = {
    command: 'open "http://localhost:8123/index.html?v=11"',
  }
  const canUseUnchanged = async () => {
    permissionCount++
    return {
      behavior: 'allow' as const,
      updatedInput: previewInput,
    }
  }

  const allowed = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'loopback-preview-open',
        name: tool.name,
        input: previewInput,
      } as never,
      {
        type: 'assistant',
        uuid: 'assistant-loopback-preview',
        message: { id: 'message-loopback-preview', content: [] },
      } as never,
      canUseUnchanged as never,
      context as never,
    ),
  )
  expect(permissionCount).toBe(1)
  expect(callCount).toBe(1)
  expect(JSON.stringify(allowed)).not.toContain('TaskListRequired')

  const rewritten = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'loopback-preview-rewritten',
        name: tool.name,
        input: previewInput,
      } as never,
      {
        type: 'assistant',
        uuid: 'assistant-loopback-preview-rewritten',
        message: {
          id: 'message-loopback-preview-rewritten',
          content: [],
        },
      } as never,
      (async () => {
        permissionCount++
        return {
          behavior: 'allow' as const,
          updatedInput: { command: 'touch /tmp/task-gate-proof' },
        }
      }) as never,
      context as never,
    ),
  )
  expect(permissionCount).toBe(2)
  expect(callCount).toBe(1)
  expect(JSON.stringify(rewritten)).toContain(
    'TaskListRequired after input update',
  )
})

test('plan-directory bootstrap reaches Bash permission but a rewritten command is gated', async () => {
  let callCount = 0
  let permissionCount = 0
  const tool = {
    name: 'Bash',
    inputSchema: z.strictObject({ command: z.string() }),
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    async call() {
      callCount++
      return { data: 'plan directory ready' }
    },
  }
  const priorCalls = Array.from({ length: 3 }, (_, index) => ({
    type: 'assistant',
    message: {
      id: `plan-bootstrap-prior-message-${index}`,
      content: [
        {
          type: 'tool_use',
          id: `plan-bootstrap-prior-${index}`,
          name: 'Read',
          input: {},
        },
      ],
    },
  }))
  const state = getDefaultAppState()
  state.toolPermissionContext = {
    ...state.toolPermissionContext,
    mode: 'plan',
  }
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
    messages: priorCalls,
    readFileState: new Map(),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  }
  const planDirectory = dirname(getPlanFilePath())
  const bootstrapInput = {
    command:
      `ls -la ${planDirectory} 2>/dev/null || ` +
      `mkdir -p ${planDirectory} && ls -la ${planDirectory}`,
  }

  const allowed = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'plan-directory-bootstrap',
        name: tool.name,
        input: bootstrapInput,
      } as never,
      {
        type: 'assistant',
        uuid: 'assistant-plan-directory-bootstrap',
        message: {
          id: 'message-plan-directory-bootstrap',
          content: [],
        },
      } as never,
      (async () => {
        permissionCount++
        return {
          behavior: 'allow' as const,
          updatedInput: bootstrapInput,
        }
      }) as never,
      context as never,
    ),
  )
  expect(permissionCount).toBe(1)
  expect(callCount).toBe(1)
  expect(JSON.stringify(allowed)).not.toContain('TaskListRequired')

  const rewritten = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'plan-directory-bootstrap-rewritten',
        name: tool.name,
        input: bootstrapInput,
      } as never,
      {
        type: 'assistant',
        uuid: 'assistant-plan-directory-bootstrap-rewritten',
        message: {
          id: 'message-plan-directory-bootstrap-rewritten',
          content: [],
        },
      } as never,
      (async () => {
        permissionCount++
        return {
          behavior: 'allow' as const,
          updatedInput: {
            command: `mkdir -p ${planDirectory} && touch /tmp/not-a-plan`,
          },
        }
      }) as never,
      context as never,
    ),
  )
  expect(permissionCount).toBe(2)
  expect(callCount).toBe(1)
  expect(JSON.stringify(rewritten)).toContain(
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
    const priorCalls = Array.from({ length: 3 }, (_, index) => ({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: `legacy-prior-${index}`,
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
        tools: [tool, { name: 'TodoWrite' }],
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      getAppState: () => state,
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
      uuid: 'assistant-legacy-plan-gate',
      message: {
        id: 'message-legacy-plan-gate',
        content: [],
      },
    }
    const refusal = await Array.fromAsync(
      runToolUse(
        {
          type: 'tool_use',
          id: 'legacy-plan-missing',
          name: 'ConditionalMutation',
          input: { action: 'write' },
        } as never,
        assistantMessage as never,
        (async (_tool, input) => ({
          behavior: 'allow' as const,
          updatedInput: input,
        })) as never,
        context as never,
      ),
    )
    expect(callCount).toBe(0)
    expect(JSON.stringify(refusal)).toContain('Call TodoWrite first')
    expect(JSON.stringify(refusal)).not.toContain('TaskCreate')

    state.todos[getSessionId()] = [
      {
        content: 'Apply the approved edit',
        activeForm: 'Applying the approved edit',
        status: 'in_progress',
      },
    ]
    const assistantMessageAfterPlan = {
      ...assistantMessage,
      uuid: 'assistant-legacy-plan-gate-after-plan',
      message: {
        ...assistantMessage.message,
        id: 'message-legacy-plan-gate-after-plan',
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
        assistantMessageAfterPlan as never,
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

test('an unchanged mutation is gated if its plan disappears during permission', async () => {
  const previousInteractive = getIsInteractive()
  setIsInteractive(false)
  let callCount = 0
  try {
    const tool = {
      name: 'TaskStateRaceMutation',
      inputSchema: z.strictObject({
        action: z.literal('write'),
      }),
      isReadOnly: () => false,
      isConcurrencySafe: () => false,
      isEnabled: () => true,
      async call() {
        callCount++
        return { data: 'must not execute without a live plan' }
      },
    }
    const state = getDefaultAppState()
    const taskListId = getSessionId()
    state.todos[taskListId] = [
      {
        content: 'Apply the guarded edit',
        activeForm: 'Applying the guarded edit',
        status: 'in_progress',
      },
    ]
    const priorCalls = Array.from({ length: 3 }, (_, index) => ({
      type: 'assistant',
      message: {
        id: `task-race-prior-${index}`,
        content: [
          {
            type: 'tool_use',
            id: `task-race-read-${index}`,
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
      getAppState: () => state,
      setAppState: () => {},
      messages: priorCalls,
      readFileState: new Map(),
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    }
    const input = { action: 'write' as const }
    const output = await Array.fromAsync(
      runToolUse(
        {
          type: 'tool_use',
          id: 'task-state-race-mutation',
          name: tool.name,
          input,
        } as never,
        {
          type: 'assistant',
          uuid: 'assistant-task-state-race',
          message: {
            id: 'message-task-state-race',
            content: [],
          },
        } as never,
        (async () => {
          // Simulate another actor completing the last task while permission
          // is pending. The effective tool input itself remains unchanged.
          state.todos[taskListId] = state.todos[taskListId]!.map(todo => ({
            ...todo,
            status: 'completed' as const,
          }))
          return {
            behavior: 'allow' as const,
            updatedInput: input,
          }
        }) as never,
        context as never,
      ),
    )

    expect(callCount).toBe(0)
    expect(JSON.stringify(output)).toContain(
      'TaskListRequired before execution',
    )
  } finally {
    setIsInteractive(previousInteractive)
  }
})

test('the exact session plan file is allowed but a rewritten workspace path is gated', async () => {
  let callCount = 0
  const planFilePath = getPlanFilePath()
  const tool = {
    name: 'Write',
    inputSchema: z.strictObject({
      file_path: z.string(),
      content: z.string(),
    }),
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    backfillObservableInput(input: { file_path: string }) {
      // Real file tools expose an absolute-path clone to hooks. Keeping this
      // hook-visible object distinct from callInput exercises that path.
      input.file_path = String(input.file_path)
    },
    async call() {
      callCount++
      return { data: 'plan updated' }
    },
  }
  const priorCalls = Array.from({ length: 3 }, (_, index) => ({
    type: 'assistant',
    message: {
      id: `plan-read-message-${index}`,
      content: [
        {
          type: 'tool_use',
          id: `plan-read-${index}`,
          name: 'Read',
          input: {},
        },
      ],
    },
  }))
  const state = getDefaultAppState()
  state.toolPermissionContext = {
    ...state.toolPermissionContext,
    mode: 'plan',
  }
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
    messages: priorCalls,
    readFileState: new Map(),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  }
  const assistantMessage = {
    type: 'assistant',
    uuid: 'assistant-plan-file-gate',
    message: {
      id: 'message-plan-file-gate',
      content: [],
    },
  }

  const output = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'plan-file-write',
        name: 'Write',
        input: {
          file_path: planFilePath,
          content: '# Implementation plan',
        },
      } as never,
      assistantMessage as never,
      (async (_tool, input) => ({
        behavior: 'allow' as const,
        updatedInput: input,
      })) as never,
      context as never,
    ),
  )

  expect(callCount, JSON.stringify(output)).toBe(1)
  expect(JSON.stringify(output)).not.toContain('TaskListRequired')

  const rewrittenOutput = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'plan-file-rewritten-to-workspace',
        name: 'Write',
        input: {
          file_path: planFilePath,
          content: '# Implementation plan',
        },
      } as never,
      assistantMessage as never,
      (async (_tool, input) => ({
        behavior: 'allow' as const,
        updatedInput: {
          ...input,
          file_path: '/tmp/not-the-current-session-plan.md',
        },
      })) as never,
      context as never,
    ),
  )

  expect(callCount).toBe(1)
  expect(JSON.stringify(rewrittenOutput)).toContain(
    'TaskListRequired after input update',
  )

  const inPlaceRewrittenOutput = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'plan-file-in-place-rewrite',
        name: 'Write',
        input: {
          file_path: planFilePath,
          content: '# In-place rewrite attempt',
        },
      } as never,
      assistantMessage as never,
      (async (_tool, input) => {
        // Permission implementations are permitted to mutate and return the
        // observable clone itself, rather than allocate a fresh object.
        input.file_path = '/tmp/not-the-current-session-plan.md'
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        }
      }) as never,
      context as never,
    ),
  )

  expect(callCount).toBe(1)
  expect(JSON.stringify(inPlaceRewrittenOutput)).toContain(
    'TaskListRequired after input update',
  )

  state.toolPermissionContext = {
    ...state.toolPermissionContext,
    mode: 'default',
  }
  const outsidePlanModeOutput = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'plan-file-outside-plan-mode',
        name: 'Write',
        input: {
          file_path: planFilePath,
          content: '# Not in plan mode',
        },
      } as never,
      assistantMessage as never,
      (async (_tool, input) => ({
        behavior: 'allow' as const,
        updatedInput: input,
      })) as never,
      context as never,
    ),
  )

  expect(callCount).toBe(1)
  expect(JSON.stringify(outsidePlanModeOutput)).toContain('TaskListRequired')
})

test('interactive tools require post-permission response validation even when input is unchanged', async () => {
  let callCount = 0
  const validationPhases: Array<string | undefined> = []
  const tool = {
    name: 'InteractiveQuestion',
    inputSchema: z.strictObject({ question: z.string() }),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    requiresUserInteraction: () => true,
    async validateInput(
      _input: { question: string },
      context: { validationPhase?: string },
    ) {
      validationPhases.push(context.validationPhase)
      if (context.validationPhase === 'post-permission') {
        return {
          result: false as const,
          message: 'No verified user response was collected',
          errorCode: 1,
        }
      }
      return { result: true as const }
    },
    async call() {
      callCount++
      return { data: 'must not execute' }
    },
  }
  const state = getDefaultAppState()
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
  const input = { question: 'Which option?' }
  const output = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'interactive-unchanged-input',
        name: tool.name,
        input,
      } as never,
      {
        type: 'assistant',
        uuid: 'assistant-interactive-validation',
        message: { id: 'message-interactive-validation', content: [] },
      } as never,
      (async () => ({
        behavior: 'allow' as const,
        updatedInput: input,
      })) as never,
      context as never,
    ),
  )

  expect(validationPhases).toEqual([undefined, 'post-permission'])
  expect(callCount).toBe(0)
  expect(JSON.stringify(output)).toContain('No verified user response')
})
