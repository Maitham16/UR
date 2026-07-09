import { describe, expect, test } from 'bun:test'
import { GitHubTool } from '../src/tools/GitHubTool/GitHubTool.js'
import { getEmptyToolPermissionContext } from '../src/Tool.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'

function makeContext() {
  return {
    abortController: new AbortController(),
    options: {
      commands: [],
      tools: [],
      mainLoopModel: 'qwen3-coder:480b-cloud',
      thinkingConfig: { type: 'disabled' as const },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      debug: false,
      verbose: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    getAppState: () => getDefaultAppState(),
    setAppState: () => {},
    messages: [],
    readFileState: new Map(),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as never
}

describe('GitHubTool', () => {
  test('declares read-only and destructive actions correctly', () => {
    expect(GitHubTool.isReadOnly({ action: 'pr_list' } as never)).toBe(true)
    expect(GitHubTool.isReadOnly({ action: 'pr_create' } as never)).toBe(false)
    expect(GitHubTool.isDestructive?.({ action: 'pr_create' } as never)).toBe(true)
    expect(GitHubTool.isDestructive?.({ action: 'repo_view' } as never)).toBe(false)
  })

  test('is enabled and has input schema', () => {
    expect(GitHubTool.isEnabled()).toBe(true)
    expect(GitHubTool.inputSchema).toBeDefined()
    expect(GitHubTool.outputSchema).toBeDefined()
  })

  test('permissions allow by default', async () => {
    const result = await GitHubTool.checkPermissions(
      { action: 'pr_list' } as never,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })
})
