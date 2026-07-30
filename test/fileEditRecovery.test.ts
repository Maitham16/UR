import { expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultAppState } from '../src/state/AppStateStore.ts'
import { FileEditTool } from '../src/tools/FileEditTool/FileEditTool.ts'
import { getEditToolDescription } from '../src/tools/FileEditTool/prompt.ts'
import { getFileModificationTime } from '../src/utils/file.ts'
import { createFileStateCacheWithSizeLimit } from '../src/utils/fileStateCache.ts'
import {
  findActualString,
  formatStringNotFoundMessage,
  isDeletionOnlyEditAlreadyApplied,
} from '../src/tools/FileEditTool/utils.ts'

test('Edit mismatch rejects a malformed HTML/JS cross-section and points to a verified JS anchor', () => {
  const file = [
    '<canvas id="game"></canvas>',
    '<script>',
    'const player = {',
    '  x: 120,',
    '  y: 240,',
    '  speed: 4,',
    '};',
    '</script>',
  ].join('\n')
  const malformedBlock = [
    '<!-- Player ship',
    'const player = {',
    '  x: 120,',
    '  y: 240,',
    '  speed: 4,',
    '};',
  ].join('\n')

  expect(findActualString(file, malformedBlock)).toBeNull()
  const message = formatStringNotFoundMessage(file, malformedBlock)

  expect(message).toContain('uniquely matches the current file at line 3')
  expect(message).toContain('complete 6-line block is not contiguous')
  expect(message).toContain('Re-read the target around line 3')
  expect(message).toContain('usually 2-4 lines')
  expect(message).toContain('do not retry this call unchanged')
})

test('Edit mismatch points past hallucinated closing tags to the distinctive target anchor', () => {
  const file = [
    '<canvas id="canvas"></canvas>',
    '<div id="menu">',
    '</div>',
    '<div id="gameOverScreen" class="menu hidden"></div>',
    '',
    '<script>',
  ].join('\n')
  const hallucinatedBlock = ['</div>', '</div>', '<script>'].join('\n')

  expect(findActualString(file, hallucinatedBlock)).toBeNull()
  const message = formatStringNotFoundMessage(file, hallucinatedBlock)

  expect(message).toContain(
    'verified anchor "<script>" from old_string line 3 uniquely matches the current file at line 6',
  )
  expect(message).toContain('complete 3-line block is not contiguous')
  expect(message).toContain('Re-read the target around line 6')
  expect(message).not.toContain('target around line 3')
})

test('Edit mismatch output bounds an over-large old_string', () => {
  const oldString = '<!-- Player ship -->\n' + 'stale JavaScript();\n'.repeat(100)
  const message = formatStringNotFoundMessage('unrelated file', oldString)

  expect(message).toContain('old_string preview truncated')
  expect(message).toContain(`${oldString.length} characters total`)
  expect(message.length).toBeLessThan(1_200)
  expect(message).not.toContain(oldString)
})

test('Edit recognizes a uniquely present deletion-only replacement as already applied', () => {
  const desired = [
    'function spawnAtEdge(type) {',
    '  const edge = Math.floor(rand(0, 4));',
  ].join('\n')
  const staleOld = [
    '// Boss wave uses interceptor type as sentinel because `isBoss` flag override handles everything',
    desired,
  ].join('\n')
  const file = ['function setup() {}', desired, 'function update() {}'].join(
    '\n',
  )

  expect(
    isDeletionOnlyEditAlreadyApplied(file, staleOld, desired, false),
  ).toBe(true)
})

test('Edit does not hide ambiguous or general stale replacements as already applied', () => {
  const desired = 'function spawnAtEdge(type) {'
  const repeated = [desired, desired].join('\n')

  expect(
    isDeletionOnlyEditAlreadyApplied(repeated, `// stale\n${desired}`, desired, false),
  ).toBe(false)
  expect(
    isDeletionOnlyEditAlreadyApplied(desired, 'unrelated old text', desired, false),
  ).toBe(false)
  expect(
    isDeletionOnlyEditAlreadyApplied(desired, `// stale\n${desired}`, desired, true),
  ).toBe(false)
})

test('Edit returns a truthful no-write result for an already-applied deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ur-edit-already-applied-'))
  try {
    const filePath = join(directory, 'game.js')
    const desired =
      'function spawnAtEdge(type) {\n  const edge = Math.floor(rand(0, 4));\n}'
    const staleOld =
      '// Boss wave uses interceptor type as sentinel because `isBoss` flag override handles everything\n' +
      desired
    writeFileSync(filePath, desired)
    const beforeMtime = statSync(filePath).mtimeMs
    const readFileState = createFileStateCacheWithSizeLimit(10)
    readFileState.set(filePath, {
      content: desired,
      timestamp: getFileModificationTime(filePath),
      offset: undefined,
      limit: undefined,
    })
    const context = {
      abortController: new AbortController(),
      options: {
        commands: [],
        tools: [],
        mainLoopModel: 'test-model',
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
      readFileState,
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      toolUseId: 'already-applied-test',
    }
    const input = {
      file_path: filePath,
      old_string: staleOld,
      new_string: desired,
      replace_all: false,
    }

    expect(
      await FileEditTool.validateInput?.(input, context as never),
    ).toEqual({ result: true })
    const result = await FileEditTool.call(
      input,
      context as never,
      undefined as never,
      undefined as never,
    )

    expect('alreadyApplied' in result.data && result.data.alreadyApplied).toBe(
      true,
    )
    expect(result.data.structuredPatch).toEqual([])
    expect(readFileSync(filePath, 'utf8')).toBe(desired)
    expect(statSync(filePath).mtimeMs).toBe(beforeMtime)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Edit leaves the file unchanged when old_string hallucinates an extra closing tag', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ur-edit-extra-closing-tag-'))
  try {
    const filePath = join(directory, 'game.html')
    const file = [
      '<canvas id="canvas"></canvas>',
      '<div id="menu">',
      '</div>',
      '<div id="gameOverScreen" class="menu hidden"></div>',
      '',
      '<script>',
    ].join('\n')
    writeFileSync(filePath, file)
    const readFileState = createFileStateCacheWithSizeLimit(10)
    readFileState.set(filePath, {
      content: file,
      timestamp: getFileModificationTime(filePath),
      offset: undefined,
      limit: undefined,
    })
    const context = {
      abortController: new AbortController(),
      options: {
        commands: [],
        tools: [],
        mainLoopModel: 'test-model',
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
      readFileState,
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      toolUseId: 'extra-closing-tag-test',
    }
    const result = await FileEditTool.validateInput?.(
      {
        file_path: filePath,
        old_string: '</div>\n</div>\n<script>',
        new_string: '</div>\n<script>',
        replace_all: false,
      },
      context as never,
    )

    expect(result).toMatchObject({ result: false, errorCode: 8 })
    expect(
      result && 'message' in result ? result.message : '',
    ).toContain('verified anchor "<script>"')
    expect(readFileSync(filePath, 'utf8')).toBe(file)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Edit prompt teaches small section-local replacements to every build', () => {
  const previousUserType = process.env.USER_TYPE
  delete process.env.USER_TYPE
  try {
    const prompt = getEditToolDescription()
    expect(prompt).toContain('as one exact, contiguous block')
    expect(prompt).toContain('copied from a recent Read of the target file')
    expect(prompt).toContain('Never reconstruct it from memory')
    expect(prompt).toContain('re-read the target region')
    expect(prompt).toContain('never retry the unchanged call')
    expect(prompt).toContain('usually 2-4 adjacent lines')
    expect(prompt).toContain('distant HTML/CSS/JavaScript sections')
    expect(prompt).toContain('separate edits')
  } finally {
    if (previousUserType === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = previousUserType
  }
})
