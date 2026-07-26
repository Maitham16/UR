import { expect, test } from 'bun:test'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addFeedback,
  captureTestRun,
  deleteArtifact,
  getArtifact,
  getWorkingDiff,
  listArtifacts,
  openArtifactAttachment,
  readArtifactBody,
  recordArtifact,
  setStatus,
  type CommandExec,
} from '../src/services/agents/artifacts.ts'

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

test('artifact diff capture disables textconv and strips ambient secrets', async () => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'ur-art-diff-safe-'))
  const repo = join(root, 'repo')
  const helper = join(root, 'textconv.sh')
  const ran = join(root, 'ran')
  const leaked = join(root, 'leaked')
  const key = 'UR_ARTIFACT_TEXTCONV_TOKEN'
  const previous = process.env[key]
  try {
    mkdirSync(repo)
    writeFileSync(
      helper,
      `#!/bin/sh\nprintf ran > ${JSON.stringify(ran)}\nif [ -n "\${${key}:-}" ]; then printf leaked > ${JSON.stringify(leaked)}; fi\ncat "$1"\n`,
    )
    chmodSync(helper, 0o700)
    git(repo, 'init')
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'diff.leak.textconv', helper)
    writeFileSync(join(repo, '.gitattributes'), 'file.txt diff=leak\n')
    writeFileSync(join(repo, 'file.txt'), 'base\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'base')
    writeFileSync(join(repo, 'file.txt'), 'changed\n')
    process.env[key] = 'must-not-reach-textconv'

    const diff = await getWorkingDiff(repo)
    expect(diff).toContain('changed')
    expect(existsSync(ran)).toBe(false)
    expect(existsSync(leaked)).toBe(false)
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('recordArtifact writes a body file and a pending manifest entry', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-'))
  const artifact = recordArtifact(tmp, { kind: 'plan', title: 'My Plan', body: '# Plan\nstep 1' })
  expect(artifact.id).toBe('1')
  expect(artifact.status).toBe('pending')
  expect(readArtifactBody(tmp, '1')).toContain('step 1')
  expect(listArtifacts(tmp).length).toBe(1)
  rmSync(tmp, { recursive: true, force: true })
})

test('approve/reject and feedback update the artifact', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-'))
  recordArtifact(tmp, { kind: 'note', title: 'n', body: 'x' })
  expect(setStatus(tmp, '1', 'approved')?.status).toBe('approved')
  addFeedback(tmp, '1', 'looks good but rename x')
  expect(getArtifact(tmp, '1')?.feedback.length).toBe(1)
  rmSync(tmp, { recursive: true, force: true })
})

test('captureTestRun records pass/fail from the command result', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-'))
  const passExec: CommandExec = async () => ({ code: 0, stdout: 'ok', stderr: '' })
  const failExec: CommandExec = async () => ({ code: 1, stdout: '', stderr: 'boom' })
  const passed = await captureTestRun(tmp, 'bun test', passExec)
  const failed = await captureTestRun(tmp, 'bun test', failExec)
  expect(passed.summary).toBe('passed')
  expect(failed.summary).toContain('failed')
  rmSync(tmp, { recursive: true, force: true })
})

test('deleteArtifact removes the entry', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-'))
  recordArtifact(tmp, { kind: 'note', title: 'n', body: 'x' })
  expect(deleteArtifact(tmp, '1')).toBe(true)
  expect(listArtifacts(tmp).length).toBe(0)
  rmSync(tmp, { recursive: true, force: true })
})

test('tampered manifest ids fail closed before any recursive deletion', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-tamper-'))
  const victim = join(tmp, 'victim')
  try {
    mkdirSync(victim)
    writeFileSync(join(victim, 'keep.txt'), 'keep')
    const root = join(tmp, '.ur', 'artifacts')
    mkdirSync(root, { recursive: true })
    writeFileSync(
      join(root, 'manifest.json'),
      JSON.stringify({
        version: 1,
        artifacts: [
          {
            id: '../../../victim',
            kind: 'note',
            title: 'tampered',
            status: 'pending',
            feedback: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    )
    expect(() => listArtifacts(tmp)).toThrow('schema validation')
    expect(() => deleteArtifact(tmp, '../../../victim')).toThrow(
      'Invalid artifact id',
    )
    expect(existsSync(join(victim, 'keep.txt'))).toBe(true)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('delete refuses a symlinked files root and preserves external data', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-delete-link-'))
  const external = mkdtempSync(join(tmpdir(), 'ur-art-external-'))
  try {
    recordArtifact(tmp, { kind: 'note', title: 'note', body: 'body' })
    const filesRoot = join(tmp, '.ur', 'artifacts', 'files')
    rmSync(filesRoot, { recursive: true, force: true })
    mkdirSync(join(external, '1'))
    const marker = join(external, '1', 'keep.txt')
    writeFileSync(marker, 'keep')
    symlinkSync(external, filesRoot, 'dir')

    expect(() => deleteArtifact(tmp, '1')).toThrow(
      'Unsafe artifact files directory',
    )
    expect(existsSync(marker)).toBe(true)
    expect(getArtifact(tmp, '1')?.id).toBe('1')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(external, { recursive: true, force: true })
  }
})

test('delete quarantines the artifact directory before concurrent path swaps', async () => {
  if (process.platform === 'win32') return
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-delete-race-'))
  const external = mkdtempSync(join(tmpdir(), 'ur-art-race-external-'))
  try {
    const artifact = recordArtifact(tmp, {
      kind: 'note',
      title: 'race note',
      body: 'primary',
    })
    const root = join(tmp, '.ur', 'artifacts')
    const directory = join(root, 'files', artifact.id)
    const attachments = []
    for (let index = 0; index < 900; index++) {
      const name = `race-${String(index).padStart(3, '0')}.txt`
      writeFileSync(join(directory, name), 'x')
      writeFileSync(join(external, name), 'external')
      attachments.push({
        path: `files/${artifact.id}/${name}`,
        role: 'race',
        mimeType: 'text/plain',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      })
    }
    const manifestPath = join(root, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.artifacts[0].attachments.push(...attachments)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const ready = join(tmp, 'watcher-ready')
    const swapped = join(tmp, 'watcher-swapped')
    const backup = join(tmp, 'artifact-backup')
    const marker = join(root, artifact.file!)
    const watcher = Bun.spawn(
      [
        process.execPath,
        '-e',
        `
          const fs = require('node:fs');
          const [directory, marker, external, backup, ready, swapped] = process.argv.slice(1);
          fs.writeFileSync(ready, 'ready');
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            if (!fs.existsSync(marker)) {
              try {
                if (fs.existsSync(directory)) fs.renameSync(directory, backup);
                if (!fs.existsSync(directory)) fs.symlinkSync(external, directory, 'dir');
                fs.writeFileSync(swapped, 'swapped');
                process.exit(0);
              } catch {}
            }
          }
          process.exit(2);
        `,
        directory,
        marker,
        external,
        backup,
        ready,
        swapped,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    for (let attempt = 0; attempt < 1_000 && !existsSync(ready); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    expect(existsSync(ready)).toBe(true)

    expect(deleteArtifact(tmp, artifact.id)).toBe(true)
    expect(await watcher.exited).toBe(0)
    expect(existsSync(swapped)).toBe(true)
    expect(readdirSync(external)).toHaveLength(900)
    expect(getArtifact(tmp, artifact.id)).toBeNull()
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(external, { recursive: true, force: true })
  }
})

test('loads, reads, and safely deletes a pre-1.48 primary body', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-legacy-'))
  try {
    const root = join(tmp, '.ur', 'artifacts')
    const files = join(root, 'files')
    mkdirSync(files, { recursive: true })
    const legacy = join(files, '1-old-note.md')
    writeFileSync(legacy, 'legacy body')
    const at = new Date().toISOString()
    writeFileSync(
      join(root, 'manifest.json'),
      `${JSON.stringify({
        version: 1,
        artifacts: [
          {
            id: '1',
            kind: 'note',
            title: 'Old note',
            file: 'files/1-old-note.md',
            status: 'pending',
            feedback: [],
            createdAt: at,
            updatedAt: at,
          },
        ],
      }, null, 2)}\n`,
    )

    expect(readArtifactBody(tmp, '1')).toBe('legacy body')
    expect(deleteArtifact(tmp, '1')).toBe(true)
    expect(existsSync(legacy)).toBe(false)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('deletes a pre-1.48 metadata-only artifact without a files directory', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-legacy-metadata-'))
  try {
    const root = join(tmp, '.ur', 'artifacts')
    mkdirSync(root, { recursive: true })
    const at = new Date().toISOString()
    writeFileSync(
      join(root, 'manifest.json'),
      `${JSON.stringify({
        version: 1,
        artifacts: [
          {
            id: '1',
            kind: 'note',
            title: 'Metadata only',
            status: 'pending',
            feedback: [],
            createdAt: at,
            updatedAt: at,
          },
        ],
      }, null, 2)}\n`,
    )

    expect(deleteArtifact(tmp, '1')).toBe(true)
    expect(listArtifacts(tmp)).toEqual([])
    expect(existsSync(join(root, 'files'))).toBe(false)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('an opened attachment descriptor is safe after path substitution', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-open-'))
  const external = mkdtempSync(join(tmpdir(), 'ur-art-secret-'))
  try {
    const artifact = recordArtifact(tmp, {
      kind: 'note',
      title: 'safe',
      body: 'safe body',
    })
    const opened = openArtifactAttachment(tmp, artifact.file!)
    expect(opened).not.toBeNull()
    const stored = join(tmp, '.ur', 'artifacts', artifact.file!)
    const moved = `${stored}.moved`
    const secret = join(external, 'secret.txt')
    writeFileSync(secret, 'outside secret')
    renameSync(stored, moved)
    symlinkSync(secret, stored)
    try {
      expect(readFileSync(opened!.fd, 'utf8')).toBe('safe body')
    } finally {
      closeSync(opened!.fd)
    }
    expect(openArtifactAttachment(tmp, artifact.file!)).toBeNull()
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(external, { recursive: true, force: true })
  }
})

test('concurrent writers reserve distinct ids and retain every entry', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-concurrent-'))
  try {
    const moduleUrl = new URL(
      '../src/services/agents/artifacts.ts',
      import.meta.url,
    ).href
    const children = Array.from({ length: 8 }, (_, index) =>
      Bun.spawn(
        [
          process.execPath,
          '--eval',
          `import { recordArtifact } from ${JSON.stringify(moduleUrl)}; recordArtifact(${JSON.stringify(tmp)}, { kind: 'note', title: ${JSON.stringify(`writer-${index}`)}, body: 'ok' });`,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      ),
    )
    const codes = await Promise.all(children.map(child => child.exited))
    expect(codes).toEqual(Array(8).fill(0))
    const artifacts = listArtifacts(tmp)
    expect(artifacts).toHaveLength(8)
    expect(new Set(artifacts.map(artifact => artifact.id)).size).toBe(8)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
