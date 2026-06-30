import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { TestRunnerTool, detectTestCommand } = await import('../src/tools/TestRunnerTool/TestRunnerTool.js')

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('TestRunnerTool', () => {
  test('detectTestCommand picks bun run test from package.json', () => {
    const dir = tempDir('ur-testrunner-')
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', scripts: { test: 'bun test' } }),
      )
      expect(detectTestCommand(dir)).toBe('bun run test')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('uses explicit command when provided', async () => {
    const result = await TestRunnerTool.call(
      { command: 'echo ok' } as never,
      {
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
        getAppState: () => ({} as never),
        setAppState: () => {},
        messages: [],
        readFileState: new Map(),
        setInProgressToolUseIDs: () => {},
        setResponseLength: () => {},
        updateFileHistoryState: () => {},
        updateAttributionState: () => {},
      },
      async () => ({ behavior: 'allow' as const, updatedInput: { command: 'echo ok' } }),
      { role: 'assistant', content: [] } as never,
    )
    const data = result.data as { success: boolean; command: string; stdout: string }
    expect(data.success).toBe(true)
    expect(data.stdout).toContain('ok')
  })
})
