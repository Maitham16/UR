import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import {
  resetStateForTests,
  setCwdState,
  setOriginalCwd,
} from '../src/bootstrap/state.js'
import {
  buildDownloadPath,
  downloadAndSaveFile,
  downloadFile,
  downloadSessionFiles,
  type FilesApiConfig,
} from '../src/services/api/filesApi.js'

const sessionId = 'session_01234567-89ab-cdef-0123-456789abcdef'
const fileId = 'file_011CNha8iCJcU1wXNR6q4V8w'

describe('Files API download path security', () => {
  let workspace: string
  let config: FilesApiConfig

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'ur-files-api-'))
    resetStateForTests()
    setOriginalCwd(workspace)
    setCwdState(workspace)
    config = {
      baseUrl: 'https://api.example.test/',
      oauthToken: 'test-token',
      sessionId,
    }
  })

  afterEach(() => {
    ;(axios.get as any).mockRestore?.()
    rmSync(workspace, { recursive: true, force: true })
    resetStateForTests()
  })

  function mockDownload(content = 'downloaded content') {
    return spyOn(axios, 'get').mockResolvedValue({
      data: Buffer.from(content),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    } as any)
  }

  test('uses a validated file ID as one encoded URL segment', async () => {
    const get = mockDownload()

    await downloadFile(fileId, config)

    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/v1/files/${encodeURIComponent(fileId)}/content`,
    )
  })

  test('rejects path-like file IDs before making an authenticated request', async () => {
    const get = spyOn(axios, 'get')

    await expect(downloadFile('../../oauth/profile', config)).rejects.toThrow(
      'Invalid file ID',
    )
    expect(get).not.toHaveBeenCalled()
  })

  test('keeps valid nested and legacy-rooted paths inside session uploads', () => {
    const expected = join(
      workspace,
      sessionId,
      'uploads',
      'reports',
      'result.txt',
    )
    expect(
      buildDownloadPath(workspace, sessionId, 'reports/result.txt'),
    ).toBe(expected)
    expect(buildDownloadPath(workspace, sessionId, expected)).toBe(expected)

    const legacyPath = join(parse(workspace).root, 'uploads', 'legacy.txt')
    expect(buildDownloadPath(workspace, sessionId, legacyPath)).toBe(
      join(workspace, sessionId, 'uploads', 'legacy.txt'),
    )
  })

  test('rejects traversal, absolute outside paths, and unsafe session IDs', () => {
    expect(
      buildDownloadPath(workspace, sessionId, '../outside.txt'),
    ).toBeNull()
    expect(
      buildDownloadPath(workspace, sessionId, 'nested/../../outside.txt'),
    ).toBeNull()
    expect(
      buildDownloadPath(workspace, sessionId, join(workspace, 'outside.txt')),
    ).toBeNull()
    expect(
      buildDownloadPath(workspace, '../escaped-session', 'result.txt'),
    ).toBeNull()
    expect(
      buildDownloadPath(workspace, 'session/escaped', 'result.txt'),
    ).toBeNull()
  })

  test('writes a normal nested destination', async () => {
    mockDownload('safe payload')

    const result = await downloadAndSaveFile(
      { fileId, relativePath: 'nested/result.txt' },
      config,
    )

    const destination = join(
      workspace,
      sessionId,
      'uploads',
      'nested',
      'result.txt',
    )
    expect(result).toEqual({
      fileId,
      path: destination,
      success: true,
      bytesWritten: Buffer.byteLength('safe payload'),
    })
    expect(readFileSync(destination, 'utf8')).toBe('safe payload')
  })

  test('rejects a symlinked destination parent', async () => {
    mockDownload()
    const uploads = join(workspace, sessionId, 'uploads')
    const outside = join(workspace, 'outside')
    mkdirSync(uploads, { recursive: true })
    mkdirSync(outside)
    symlinkSync(outside, join(uploads, 'linked'), 'dir')

    const result = await downloadAndSaveFile(
      { fileId, relativePath: 'linked/escaped.txt' },
      config,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('symlinked download directory')
    expect(existsSync(join(outside, 'escaped.txt'))).toBe(false)
  })

  test('rejects a symlinked destination without modifying its target', async () => {
    mockDownload('attacker-controlled replacement')
    const uploads = join(workspace, sessionId, 'uploads')
    const outsideFile = join(workspace, 'outside.txt')
    const destination = join(uploads, 'result.txt')
    mkdirSync(uploads, { recursive: true })
    writeFileSync(outsideFile, 'original')
    symlinkSync(outsideFile, destination, 'file')

    const result = await downloadAndSaveFile(
      { fileId, relativePath: 'result.txt' },
      config,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('symlinked download destination')
    expect(readFileSync(outsideFile, 'utf8')).toBe('original')
    expect(lstatSync(destination).isSymbolicLink()).toBe(true)
  })

  test('rejects an invalid concurrency instead of returning sparse results', async () => {
    const get = spyOn(axios, 'get')

    await expect(
      downloadSessionFiles(
        [{ fileId, relativePath: 'result.txt' }],
        config,
        0,
      ),
    ).rejects.toThrow('positive integer')
    expect(get).not.toHaveBeenCalled()
  })
})
