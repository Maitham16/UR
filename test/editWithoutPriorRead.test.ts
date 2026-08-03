import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import { FileEditTool } from '../src/tools/FileEditTool/FileEditTool.js'
import { FileWriteTool } from '../src/tools/FileWriteTool/FileWriteTool.js'
import { createFileStateCacheWithSizeLimit } from '../src/utils/fileStateCache.js'

function makeToolUseContext(): Record<string, unknown> {
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

/**
 * A matching old_string is proof the model has the file's current content —
 * the same thing a prior Read establishes, and stronger, because it is checked
 * against the bytes on disk rather than a snapshot. Demanding a Read on top of
 * it spent a whole model round trip to learn nothing.
 */
describe('Edit does not require a prior Read when old_string matches', () => {
  test('validateInput accepts an unread file whose content matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-edit-noread-'))
    const filePath = join(dir, 'sample.ts')
    writeFileSync(filePath, 'export const value = "old"\n')

    const context = makeToolUseContext()
    // Deliberately no readFileState entry — the file was never read.
    const result = await FileEditTool.validateInput!(
      {
        file_path: filePath,
        old_string: '"old"',
        new_string: '"new"',
        replace_all: false,
      } as never,
      context as never,
    )

    expect(result.result).toBe(true)
  })

  test('the verified content is recorded, so the staleness check still works', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-edit-noread-state-'))
    const filePath = join(dir, 'sample.ts')
    const original = 'export const value = "old"\n'
    writeFileSync(filePath, original)

    const context = makeToolUseContext()
    await FileEditTool.validateInput!(
      {
        file_path: filePath,
        old_string: '"old"',
        new_string: '"new"',
        replace_all: false,
      } as never,
      context as never,
    )

    const recorded = (
      context.readFileState as ReturnType<
        typeof createFileStateCacheWithSizeLimit
      >
    ).get(filePath)
    expect(recorded?.content).toBe(original)
  })

  test('a genuinely absent string is still refused, and names the missing read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-edit-noread-miss-'))
    const filePath = join(dir, 'sample.ts')
    writeFileSync(filePath, 'export const value = "old"\n')

    const context = makeToolUseContext()
    const result = await FileEditTool.validateInput!(
      {
        file_path: filePath,
        old_string: 'nothing like this exists',
        new_string: 'x',
        replace_all: false,
      } as never,
      context as never,
    )

    expect(result.result).toBe(false)
    expect(result.message).toContain('has not been read in this session')
  })

  test('the edit applies end to end without any prior Read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-edit-noread-apply-'))
    const filePath = join(dir, 'sample.ts')
    writeFileSync(filePath, 'export const value = "old"\n')

    const context = makeToolUseContext()
    await FileEditTool.validateInput!(
      {
        file_path: filePath,
        old_string: '"old"',
        new_string: '"new"',
        replace_all: false,
      } as never,
      context as never,
    )
    await FileEditTool.call(
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

    expect(readFileSync(filePath, 'utf8')).toBe('export const value = "new"\n')
  })
})

describe('Write records the file it is about to overwrite', () => {
  test('an unread existing file is read and recorded rather than refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-write-noread-'))
    const filePath = join(dir, 'sample.ts')
    const original = 'export const value = "old"\n'
    writeFileSync(filePath, original)

    const context = makeToolUseContext()
    const result = await FileWriteTool.validateInput!(
      { file_path: filePath, content: 'export const value = "new"\n' } as never,
      context as never,
    )

    expect(result.result).toBe(true)
    // Recorded from disk, so the "modified since read" check has a baseline.
    const recorded = (
      context.readFileState as ReturnType<
        typeof createFileStateCacheWithSizeLimit
      >
    ).get(filePath)
    expect(recorded?.content).toBe(original)
  })

  test('a file that changed after a real read is still refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-write-stale-'))
    const filePath = join(dir, 'sample.ts')
    writeFileSync(filePath, 'first\n')

    const context = makeToolUseContext()
    ;(
      context.readFileState as ReturnType<
        typeof createFileStateCacheWithSizeLimit
      >
    ).set(filePath, {
      content: 'first\n',
      timestamp: 1,
      offset: undefined,
      limit: undefined,
    })
    writeFileSync(filePath, 'changed underneath\n')

    const result = await FileWriteTool.validateInput!(
      { file_path: filePath, content: 'third\n' } as never,
      context as never,
    )

    expect(result.result).toBe(false)
    expect(result.message).toContain('modified since read')
  })
})
