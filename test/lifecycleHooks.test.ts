import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HOOK_EVENTS,
  BeforeEditHookInputSchema,
  AfterEditHookInputSchema,
  BeforeCommandHookInputSchema,
  AfterCommandHookInputSchema,
  BeforeCommitHookInputSchema,
  OnFailureHookInputSchema,
} from '../src/entrypoints/sdk/coreSchemas.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import { getSessionId } from '../src/bootstrap/state.js'
import { readCommandLog } from '../src/services/agents/commandLog.js'
import { BashTool } from '../src/tools/BashTool/BashTool.js'
import { FileEditTool } from '../src/tools/FileEditTool/FileEditTool.js'
import { createFileStateCacheWithSizeLimit } from '../src/utils/fileStateCache.js'
import { getFileModificationTime } from '../src/utils/file.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

function makeToolUseContext() {
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
    readFileState: createFileStateCacheWithSizeLimit(100),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    toolUseId: 'test-tool-use',
  }
}

describe('lifecycle hooks', () => {
  it('HOOK_EVENTS includes the six new lifecycle events', () => {
    for (const event of [
      'BeforeEdit',
      'AfterEdit',
      'BeforeCommand',
      'AfterCommand',
      'BeforeCommit',
      'OnFailure',
    ]) {
      expect(HOOK_EVENTS as readonly string[]).toContain(event)
    }
  })

  it('schemas validate lifecycle hook inputs', () => {
    const base = {
      session_id: 's1',
      transcript_path: '/tmp/t.json',
      cwd: '/tmp',
    }
    expect(
      BeforeEditHookInputSchema().safeParse({
        ...base,
        hook_event_name: 'BeforeEdit',
        file_path: '/tmp/a.ts',
        old_string: 'a',
        new_string: 'b',
        replace_all: false,
        tool_use_id: 't1',
      }).success,
    ).toBe(true)

    expect(
      AfterEditHookInputSchema().safeParse({
        ...base,
        hook_event_name: 'AfterEdit',
        file_path: '/tmp/a.ts',
        success: true,
      }).success,
    ).toBe(true)

    expect(
      BeforeCommandHookInputSchema().safeParse({
        ...base,
        hook_event_name: 'BeforeCommand',
        command: 'bun test',
        shell_type: 'bash',
      }).success,
    ).toBe(true)

    expect(
      AfterCommandHookInputSchema().safeParse({
        ...base,
        hook_event_name: 'AfterCommand',
        command: 'bun test',
        exit_code: 0,
      }).success,
    ).toBe(true)

    expect(
      BeforeCommitHookInputSchema().safeParse({
        ...base,
        hook_event_name: 'BeforeCommit',
        command: 'git commit -m "x"',
      }).success,
    ).toBe(true)

    expect(
      OnFailureHookInputSchema().safeParse({
        ...base,
        hook_event_name: 'OnFailure',
        error: 'oops',
        stage: 'tool',
      }).success,
    ).toBe(true)
  })

  it('wires lifecycle hooks into edit, command, commit, and failure paths', () => {
    const root = process.cwd()
    const fileEdit = readFileSync(
      join(root, 'src/tools/FileEditTool/FileEditTool.ts'),
      'utf-8',
    )
    expect(fileEdit).toContain('executeBeforeEditHooks')
    expect(fileEdit).toContain('executeAfterEditHooks')

    const bash = readFileSync(join(root, 'src/tools/BashTool/BashTool.tsx'), 'utf-8')
    expect(bash).toContain('executeBeforeCommandHooks')
    expect(bash).toContain('executeAfterCommandHooks')
    expect(bash).toContain('executeBeforeCommitHooks')
    expect(bash).toContain('executeOnFailureHooks')

    const powershell = readFileSync(
      join(root, 'src/tools/PowerShellTool/PowerShellTool.tsx'),
      'utf-8',
    )
    expect(powershell).toContain('executeBeforeCommandHooks')
    expect(powershell).toContain('executeAfterCommandHooks')
    expect(powershell).toContain('executeBeforeCommitHooks')

    const toolExecution = readFileSync(
      join(root, 'src/services/tools/toolExecution.ts'),
      'utf-8',
    )
    expect(toolExecution).toContain('executeOnFailureHooks')
  })

  it('runs FileEditTool.call with lifecycle hooks wired and a scoped context', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-file-edit-hook-'))
    try {
      const filePath = join(dir, 'evals.ts')
      const original = 'export const value = "old"\n'
      writeFileSync(filePath, original)

      const context = makeToolUseContext()
      context.readFileState.set(filePath, {
        content: original,
        timestamp: getFileModificationTime(filePath),
        offset: undefined,
        limit: undefined,
      })

      const result = await FileEditTool.call(
        {
          file_path: filePath,
          old_string: '"old"',
          new_string: '"new"',
          replace_all: false,
        } as never,
        context as never,
        undefined as never,
        undefined as never,
      )

      expect(result.data.filePath).toBe(filePath)
      expect(readFileSync(filePath, 'utf-8')).toBe('export const value = "new"\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs BashTool.call with command hooks and timeout options in scope', async () => {
    const context = makeToolUseContext()
    const result = await BashTool.call(
      {
        command: 'printf ur-hook-runtime',
        timeout: 2_000,
        dangerouslyDisableSandbox: true,
      } as never,
      context as never,
      undefined as never,
      undefined as never,
    )

    expect(result.data.stdout).toBe('ur-hook-runtime')
    expect(result.data.interrupted).toBe(false)
  })

  it('logs failed BashTool commands with the actual exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-bash-log-failure-'))
    try {
      await runWithCwdOverride(dir, async () => {
        const context = makeToolUseContext()
        let thrown: unknown
        try {
          await BashTool.call(
            {
              command: 'sh -c "echo nope; exit 7"',
              timeout: 2_000,
              description: 'exercise failed command audit',
              dangerouslyDisableSandbox: true,
            } as never,
            context as never,
            undefined as never,
            undefined as never,
          )
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeTruthy()
        const logs = readCommandLog(dir, getSessionId())
        const failed = logs.find(log => log.command.includes('echo nope'))
        expect(failed?.exitCode).toBe(7)
        expect(failed?.stdout).toContain('nope')
        expect(failed?.reason).toBe('exercise failed command audit')
        expect(failed?.nextAction).toBeTruthy()
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ships the Bash timeout binding in the production bundle', () => {
    const dist = readFileSync(join(process.cwd(), 'dist/cli.js'), 'utf-8')
    const bashHookIndex = dist.indexOf(
      'await executeBeforeCommandHooks(input.command, "bash"',
    )
    expect(bashHookIndex).toBeGreaterThan(0)

    const timeoutBindingIndex = dist.lastIndexOf(
      'const timeoutMs = input.timeout || getDefaultTimeoutMs',
      bashHookIndex,
    )
    expect(timeoutBindingIndex).toBeGreaterThan(0)
    expect(timeoutBindingIndex).toBeLessThan(bashHookIndex)
  })
})
