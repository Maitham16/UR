import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMoveAst, planMoveAst } from '../src/services/repoEditing/ast/repoEditAst.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeRepo(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, path)
    mkdirSync(abs.replace(/\/[^/]*$/, ''), { recursive: true })
    writeFileSync(abs, content)
  }
}

describe('AST-aware move', () => {
  test('planMoveAst inserts function into target and removes from source', async () => {
    const dir = tempDir('ur-ast-move-')
    writeRepo(dir, {
      'src/a.ts': 'export function helper(): number { return 1 }\n',
      'src/b.ts': '',
    })

    const plan = await planMoveAst({
      root: dir,
      symbol: 'helper',
      targetFile: 'src/b.ts',
      file: 'src/a.ts',
    })
    expect(plan.edits.edits.length).toBe(2)
    await applyMoveAst({
      root: dir,
      symbol: 'helper',
      targetFile: 'src/b.ts',
      file: 'src/a.ts',
    })
    expect(readFileSync(join(dir, 'src/b.ts'), 'utf-8')).toContain('export function helper(): number { return 1 }')
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf-8')).not.toContain('export function helper')
    rmSync(dir, { recursive: true, force: true })
  })
})
