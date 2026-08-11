import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  archiveSessionInProject,
  unarchiveSessionInProject,
} from '../src/utils/sessionArchive.js'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('local session archive', () => {
  test('moves the transcript and auxiliary data out of resume discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ur-session-archive-'))
    created.push(root)
    const projectDir = join(root, 'project')
    const sessionId = '11111111-1111-4111-8111-111111111111'
    await mkdir(join(projectDir, sessionId), { recursive: true })
    await writeFile(join(projectDir, `${sessionId}.jsonl`), '{"type":"user"}\n')
    await writeFile(join(projectDir, sessionId, 'agent.jsonl'), '{}\n')

    const archived = await archiveSessionInProject(projectDir, sessionId)

    expect(archived.sessionId).toBe(sessionId)
    expect(existsSync(join(projectDir, `${sessionId}.jsonl`))).toBe(false)
    expect(
      existsSync(
        join(projectDir, '.session-archive', sessionId, 'transcript.jsonl'),
      ),
    ).toBe(true)
    expect(
      await readFile(
        join(projectDir, '.session-archive', sessionId, 'data', 'agent.jsonl'),
        'utf8',
      ),
    ).toBe('{}\n')

    await unarchiveSessionInProject(projectDir, sessionId)
    expect(await readFile(join(projectDir, `${sessionId}.jsonl`), 'utf8')).toBe(
      '{"type":"user"}\n',
    )
    expect(await readFile(join(projectDir, sessionId, 'agent.jsonl'), 'utf8')).toBe(
      '{}\n',
    )
    expect(existsSync(join(projectDir, '.session-archive', sessionId))).toBe(false)
  })

  test('rejects a symlinked archive root instead of moving data outside the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ur-session-archive-link-'))
    created.push(root)
    const projectDir = join(root, 'project')
    const outside = join(root, 'outside')
    const sessionId = '22222222-2222-4222-8222-222222222222'
    await mkdir(projectDir, { recursive: true })
    await mkdir(outside)
    await symlink(outside, join(projectDir, '.session-archive'), 'dir')
    await writeFile(join(projectDir, `${sessionId}.jsonl`), '{}\n')

    await expect(archiveSessionInProject(projectDir, sessionId)).rejects.toThrow(
      'not a private directory',
    )
    expect(existsSync(join(projectDir, `${sessionId}.jsonl`))).toBe(true)
    expect((await readFile(join(projectDir, `${sessionId}.jsonl`), 'utf8'))).toBe(
      '{}\n',
    )
  })

  test('rejects a manifest that redirects restore outside its project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ur-session-archive-manifest-'))
    created.push(root)
    const projectDir = join(root, 'project')
    const outside = join(root, 'outside')
    const sessionId = '33333333-3333-4333-8333-333333333333'
    await mkdir(projectDir, { recursive: true })
    await mkdir(outside)
    await writeFile(join(projectDir, `${sessionId}.jsonl`), '{}\n')
    await archiveSessionInProject(projectDir, sessionId)
    const manifestPath = join(
      projectDir,
      '.session-archive',
      sessionId,
      'manifest.json',
    )
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.projectDir = outside
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)

    await expect(
      unarchiveSessionInProject(projectDir, sessionId),
    ).rejects.toThrow('was not found')
    expect(existsSync(join(outside, `${sessionId}.jsonl`))).toBe(false)
  })
})
