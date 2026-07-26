import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const LOCK_STALE_MS = 30_000
const LOCK_WAIT_MS = 2_000
const lockWaitArray = new Int32Array(new SharedArrayBuffer(4))

function assertContained(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Private state path escapes its storage root')
  }
}

/**
 * Create a private directory without accepting symlinked path components below
 * `root`. The root itself is supplied by trusted runtime code (project/session
 * storage); every child component is checked after creation.
 */
export function ensurePrivateDirectory(root: string, target: string): void {
  assertContained(root, target)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Private state root must be a real directory')
  }

  const rel = relative(resolve(root), resolve(target))
  let current = resolve(root)
  for (const segment of rel.split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment)
    try {
      mkdirSync(current, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Private state directory chain contains an unsafe path')
    }
    chmodSync(current, 0o700)
  }
}

export function readPrivateText(
  root: string,
  path: string,
  maxBytes: number,
): string | null {
  assertContained(root, path)
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Private state must be a regular file')
  }
  if (stat.size > maxBytes) {
    throw new Error(`Private state exceeds its ${maxBytes} byte safety limit`)
  }
  return readFileSync(path, 'utf8')
}

export function writePrivateTextAtomic(
  root: string,
  path: string,
  body: string,
  maxBytes: number,
): void {
  assertContained(root, path)
  if (Buffer.byteLength(body) > maxBytes) {
    throw new Error(`Private state exceeds its ${maxBytes} byte safety limit`)
  }
  ensurePrivateDirectory(root, dirname(path))
  if (existsSync(path)) {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Private state destination is unsafe')
    }
  }
  const temporary = join(
    dirname(path),
    `.${randomUUID()}.${process.pid}.tmp`,
  )
  try {
    writeFileSync(temporary, body, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    const descriptor = openSync(temporary, constants.O_RDONLY)
    try {
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    try {
      unlinkSync(temporary)
    } catch {
      // The rename consumed the temporary file, or creation never completed.
    }
  }
}

export function appendPrivateText(
  root: string,
  path: string,
  body: string,
  maxBytes: number,
): void {
  assertContained(root, path)
  ensurePrivateDirectory(root, dirname(path))
  const existingBytes = existsSync(path) ? lstatSync(path).size : 0
  if (existingBytes + Buffer.byteLength(body) > maxBytes) {
    throw new Error(`Private state would exceed its ${maxBytes} byte safety limit`)
  }
  if (existsSync(path)) {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Private state destination is unsafe')
    }
  }
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
  const descriptor = openSync(
    path,
    constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | noFollow,
    0o600,
  )
  try {
    const bytes = Buffer.from(body)
    let offset = 0
    while (offset < bytes.length) {
      const written = writeSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
      )
      if (written <= 0) throw new Error('Failed to append private state')
      offset += written
    }
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  chmodSync(path, 0o600)
}

/** Synchronous cross-process lock suitable for short state transactions. */
export function withPrivateStateLock<T>(
  root: string,
  name: string,
  fn: () => T,
): T {
  ensurePrivateDirectory(root, root)
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(name)) {
    throw new Error('Invalid private state lock name')
  }
  const lockPath = join(root, `.${name}.lock`)
  const started = Date.now()
  for (;;) {
    try {
      mkdirSync(lockPath, { mode: 0o700 })
      try {
        writeFileSync(
          join(lockPath, 'owner.json'),
          `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`,
          { flag: 'wx', mode: 0o600 },
        )
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true })
        throw error
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let stat
      try {
        stat = lstatSync(lockPath)
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw statError
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('Private state lock path is unsafe')
      }
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        rmSync(lockPath, { recursive: true, force: true })
        continue
      }
      if (Date.now() - started >= LOCK_WAIT_MS) {
        throw new Error('Private state is busy; retry the operation')
      }
      Atomics.wait(lockWaitArray, 0, 0, 10)
    }
  }
  try {
    return fn()
  } finally {
    rmSync(lockPath, { recursive: true, force: true })
  }
}
