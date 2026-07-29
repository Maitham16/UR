import { beforeEach, describe, expect, test } from 'bun:test'
import {
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../src/Tool.ts'
import {
  activeAgentCount,
  canSpawnAgent,
  registerAgent,
  resetFanOutRegistryForTesting,
} from '../src/tools/AgentTool/fanOutLimits.ts'
import { runAgent } from '../src/tools/AgentTool/runAgent.ts'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../src/utils/fileStateCache.ts'
import { asSystemPrompt } from '../src/utils/systemPromptType.ts'

const SINGLE_SLOT_LIMIT = { maxDepth: 3, maxConcurrent: 1 }

function createToolUseContext(): ToolUseContext {
  let appState = {
    toolPermissionContext: getEmptyToolPermissionContext(),
    todos: {},
    tasks: {},
  } as any

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'qwen3-coder:480b-cloud',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: {} as never,
    },
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    ),
    getAppState: () => appState,
    setAppState: update => {
      appState = update(appState)
    },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as ToolUseContext
}

function createRunParams(
  agentId: string,
  options: {
    userContext?: Record<string, string> | Promise<Record<string, string>>
    onCacheSafeParams?: () => void
  },
): Parameters<typeof runAgent>[0] {
  return {
    agentDefinition: {
      agentType: 'fan-out-cleanup-test',
      whenToUse: 'test only',
      source: 'userSettings',
      getSystemPrompt: () => 'unused test prompt',
    } as never,
    promptMessages: [],
    toolUseContext: createToolUseContext(),
    canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
    isAsync: false,
    querySource: 'test:fan-out-cleanup',
    availableTools: [],
    useExactTools: true,
    override: {
      agentId: agentId as never,
      userContext: (options.userContext ?? {}) as never,
      systemContext: {},
      systemPrompt: asSystemPrompt(['test system prompt']),
    },
    onCacheSafeParams: options.onCacheSafeParams,
  }
}

async function expectFailureReleasesAndReusesSlot(
  params: Parameters<typeof runAgent>[0],
  expectedError: Error,
): Promise<void> {
  const iterator = runAgent(params)
  await expect(iterator.next()).rejects.toThrow(expectedError.message)

  expect(activeAgentCount()).toBe(0)
  expect(canSpawnAgent(undefined, SINGLE_SLOT_LIMIT)).toMatchObject({
    allowed: true,
    depth: 1,
  })

  // Reuse the exact same registry key. A stale/double cleanup from the failed
  // generator must not remove the replacement registration.
  const reusableAgentId = params.override!.agentId as string
  const releaseReplacement = registerAgent(reusableAgentId, undefined, 1)
  expect(activeAgentCount()).toBe(1)

  // A closed failed generator cannot release a later occupant's slot.
  await iterator.return()
  expect(activeAgentCount()).toBe(1)
  releaseReplacement()
  expect(activeAgentCount()).toBe(0)
}

beforeEach(() => resetFanOutRegistryForTesting())

describe('runAgent fan-out cleanup', () => {
  test('releases the slot when asynchronous context setup rejects', async () => {
    const setupError = new Error('injected context setup failure')
    const userContext = new Promise<Record<string, string>>((_, reject) => {
      setTimeout(() => reject(setupError), 0)
    })

    await expectFailureReleasesAndReusesSlot(
      createRunParams('context-failure-agent', { userContext }),
      setupError,
    )
  })

  test('releases the slot when late pre-query setup throws', async () => {
    const setupError = new Error('injected cache setup failure')

    await expectFailureReleasesAndReusesSlot(
      createRunParams('late-failure-agent', {
        onCacheSafeParams: () => {
          throw setupError
        },
      }),
      setupError,
    )
  })
})
