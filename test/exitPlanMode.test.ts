import { expect, test } from 'bun:test'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import { runToolUse } from '../src/services/tools/toolExecution.js'
import { ExitPlanModeV2Tool } from '../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts'

test('ExitPlanMode accepts allowedPrompts as strings', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowedPrompts: [
      'Generate the HTML file and all required assets for the one-level Mario game',
      'Test the game by opening it in a browser or running a local server',
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([
    {
      tool: 'Bash',
      prompt:
        'Generate the HTML file and all required assets for the one-level Mario game',
    },
    {
      tool: 'Bash',
      prompt:
        'Test the game by opening it in a browser or running a local server',
    },
  ])
})

test('ExitPlanMode accepts a single allowed prompt string', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowedPrompts: 'Run the test suite',
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([
    {
      tool: 'Bash',
      prompt: 'Run the test suite',
    },
  ])
})

test('ExitPlanMode accepts command-like allowed prompt objects', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowedPrompts: [
      {
        tool: 'BashTool',
        command: 'bun test',
      },
      {
        description: 'Run typecheck before finishing',
      },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([
    {
      tool: 'Bash',
      prompt: 'bun test',
    },
    {
      tool: 'Bash',
      prompt: 'Run typecheck before finishing',
    },
  ])
})

test('ExitPlanMode accepts allowed prompt maps and filters non-Bash tools', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowed_prompts: {
      Bash: ['Run tests', 'Install dependencies'],
      Edit: ['Modify source files'],
    },
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([
    {
      tool: 'Bash',
      prompt: 'Run tests',
    },
    {
      tool: 'Bash',
      prompt: 'Install dependencies',
    },
  ])
})

test('ExitPlanMode tolerates null allowed prompts', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowedPrompts: null,
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([])
})

test('ExitPlanMode rejects a new out-of-mode call but permits post-permission revalidation', async () => {
  const state = getDefaultAppState()
  const context = {
    getAppState: () => state,
    options: { mainLoopModel: 'test-model' },
  }

  const initial = await ExitPlanModeV2Tool.validateInput?.(
    {},
    context as never,
  )
  expect(initial).toMatchObject({
    result: false,
    message: expect.stringContaining('not in plan mode'),
  })

  const postPermission = await ExitPlanModeV2Tool.validateInput?.(
    {},
    {
      ...context,
      validationPhase: 'post-permission',
    } as never,
  )
  expect(postPermission).toEqual({ result: true })
})

test('ExitPlanMode completes when approval changes mode and rewrites allowed prompts', async () => {
  let state = getDefaultAppState()
  state = {
    ...state,
    toolPermissionContext: {
      ...state.toolPermissionContext,
      mode: 'plan',
      prePlanMode: 'default',
    },
  }
  const toolUse = {
    type: 'tool_use',
    id: 'exit-plan-after-approval',
    name: ExitPlanModeV2Tool.name,
    input: {
      allowedPrompts: ['Run focused tests'],
    },
  }
  const assistantMessage = {
    type: 'assistant',
    uuid: 'assistant-exit-plan-after-approval',
    message: {
      id: 'message-exit-plan-after-approval',
      content: [toolUse],
    },
  }
  let permissionChecked = false
  const context = {
    abortController: new AbortController(),
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools: [ExitPlanModeV2Tool],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    getAppState: () => state,
    setAppState: (update: (previous: typeof state) => typeof state) => {
      state = update(state)
    },
    messages: [],
    readFileState: new Map(),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  }

  const output = await Array.fromAsync(
    runToolUse(
      toolUse as never,
      assistantMessage as never,
      (async () => {
        permissionChecked = true
        state = {
          ...state,
          toolPermissionContext: {
            ...state.toolPermissionContext,
            mode: 'default',
            prePlanMode: undefined,
          },
        }
        // The V2 approval UI consumes allowedPrompts into permission rules and
        // returns an empty tool input, so the final call signature changes.
        return {
          behavior: 'allow' as const,
          updatedInput: {},
        }
      }) as never,
      context as never,
    ),
  )

  const serialized = JSON.stringify(output)
  expect(permissionChecked).toBe(true)
  expect(serialized).not.toContain('not in plan mode')
  expect(serialized).not.toContain('tool_use_error')
  expect(serialized).toContain('approved exiting plan mode')
})
