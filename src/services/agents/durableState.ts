import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { lockSync } from '../../utils/lockfile.js'

/** A fencing token identifies a scheduler, not a reusable worker label or PID. */
export type ProcessOwner = {
  token: string
  pid: number
  host: string
  acquiredAt: string
  heartbeatAt: string
  releasedAt?: string
}

export function makeProcessOwner(): ProcessOwner {
  const at = new Date().toISOString()
  return { token: randomUUID(), pid: process.pid, host: hostname(), acquiredAt: at, heartbeatAt: at }
}

export function isProcessAlive(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return false
  try { process.kill(Number(pid), 0); return true } catch (error) {
    // Permission denied proves existence; only ESRCH proves the process is gone.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** Never steal an expired lease from a live local process (including a paused one).
 * Foreign hosts cannot be probed safely: retain their claim rather than duplicate effects.
 * PID reuse can conservatively retain a dead owner's claim, never authorize replay.
 */
export function ownerMayBeAlive(owner: ProcessOwner | undefined): boolean {
  return !!owner && !owner.releasedAt && (owner.host !== hostname() || isProcessAlive(owner.pid))
}

export function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    renameSync(temporary, path)
    // Rename is atomic; syncing the directory also makes it durable on POSIX.
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}

const waitArray = new Int32Array(new SharedArrayBuffer(4))
export function withStateLock<T>(path: string, operation: () => T): T {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (!existsSync(path)) writeFileSync(path, '', { flag: 'a', mode: 0o600 })
  let release: (() => void) | undefined
  for (let attempt = 0; !release; attempt++) {
    try { release = lockSync(path, { realpath: false, stale: 30_000 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED' || attempt >= 20) throw error
      Atomics.wait(waitArray, 0, 0, Math.min(100, 10 + attempt * 5))
    }
  }
  try { return operation() } finally { release() }
}
