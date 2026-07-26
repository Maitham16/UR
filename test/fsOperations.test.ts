import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  getPathsForPermissionCheck,
  NodeFsOperations,
} from '../src/utils/fsOperations.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

test.skipIf(process.platform === 'win32')(
  'permission paths resolve a dangling link through a symlinked parent',
  () => {
    const root = tempDir('ur-fs-permissions-')
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside')

    try {
      mkdirSync(workspace)
      mkdirSync(outside)

      const alias = join(workspace, 'alias')
      const dangling = join(workspace, 'evil')
      symlinkSync(outside, alias, 'dir')
      symlinkSync('alias/new.txt', dangling, 'file')

      const paths = getPathsForPermissionCheck(dangling)
      expect(paths).toContain(join(workspace, 'alias', 'new.txt'))
      expect(paths).toContain(join(realpathSync(outside), 'new.txt'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test('recursive mkdir rejects an existing regular file asynchronously', async () => {
  const root = tempDir('ur-fs-mkdir-async-')
  const file = join(root, 'not-a-directory')
  try {
    writeFileSync(file, 'content')
    await expect(NodeFsOperations.mkdir(file)).rejects.toThrow()

    const existingDirectory = join(root, 'existing-directory')
    mkdirSync(existingDirectory)
    await expect(NodeFsOperations.mkdir(existingDirectory)).resolves.toBeUndefined()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recursive mkdir rejects an existing regular file synchronously', () => {
  const root = tempDir('ur-fs-mkdir-sync-')
  const file = join(root, 'not-a-directory')
  try {
    writeFileSync(file, 'content')
    expect(() => NodeFsOperations.mkdirSync(file)).toThrow()

    const existingDirectory = join(root, 'existing-directory')
    mkdirSync(existingDirectory)
    expect(() => NodeFsOperations.mkdirSync(existingDirectory)).not.toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readSync closes descriptor zero', async () => {
  const root = tempDir('ur-fs-read-fd-zero-')
  const file = join(root, 'input.txt')
  try {
    writeFileSync(file, 'abc')
    const bundle = join(root, 'fsOperations.mjs')
    const build = await Bun.build({
      entrypoints: [
        fileURLToPath(new URL('../src/utils/fsOperations.ts', import.meta.url)),
      ],
      outdir: root,
      target: 'node',
      format: 'esm',
      naming: 'fsOperations.mjs',
    })
    expect(build.success).toBe(true)

    const node = Bun.which('node')
    expect(node).not.toBeNull()
    if (!node) throw new Error('Node.js is required for descriptor-zero test')

    const script = [
      "import { closeSync, fstatSync } from 'node:fs'",
      `import { NodeFsOperations } from ${JSON.stringify(pathToFileURL(bundle).href)}`,
      'closeSync(0)',
      `const result = NodeFsOperations.readSync(${JSON.stringify(file)}, { length: 1 })`,
      'let descriptorClosed = false',
      'try { fstatSync(0) } catch (error) { descriptorClosed = error?.code === "EBADF" }',
      'process.stdout.write(JSON.stringify({ byte: result.buffer.toString("utf8"), descriptorClosed }))',
    ].join('\n')
    const child = spawnSync(node, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    })

    expect(child.status).toBe(0)
    expect(child.stderr).toBe('')
    expect(JSON.parse(child.stdout)).toEqual({
      byte: 'a',
      descriptorClosed: true,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
