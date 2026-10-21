import { randomUUID } from 'node:crypto'
import { renameSync, rmSync, writeFileSync } from 'node:fs'

/** Each published index artifact is complete, including during concurrent reads. */
export function writeIndexJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}
