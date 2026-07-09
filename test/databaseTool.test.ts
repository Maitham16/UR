import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { DatabaseTool } = await import('../src/tools/DatabaseTool/DatabaseTool.js')

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

// DatabaseTool shells out to the sqlite3 binary; skip when it is not installed.
const hasSqlite3 = Bun.which('sqlite3') !== null

// DatabaseTool's concrete call(input) ignores context/permission arguments.

describe('DatabaseTool', () => {
  test.skipIf(!hasSqlite3)('runs a sqlite query and returns rows', async () => {
    const dir = tempDir('ur-database-')
    try {
      const db = join(dir, 'test.db')
      const init = await DatabaseTool.call(
        { connection: 'sqlite', database: db, query: 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t VALUES (1, "alice"); SELECT * FROM t;', readonly: false } as never,
      )
      expect(init.data.success).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('readonly blocks write queries', async () => {
    const result = await DatabaseTool.call(
      { connection: 'sqlite', database: ':memory:', query: 'INSERT INTO t VALUES (1)', readonly: true } as never,
    )
    expect(result.data.success).toBe(false)
    expect(result.data.error).toContain('readonly')
  })
})
