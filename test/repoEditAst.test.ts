import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyRenameAst, planRenameAst } from '../src/services/repoEditing/ast/repoEditAst.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeTsRepo(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, path)
    mkdirSync(abs.replace(/\/[^/]*$/, ''), { recursive: true })
    writeFileSync(abs, content)
  }
}

describe('AST-aware repo editing', () => {
  test('planRenameAst only renames binding-aware references', async () => {
    const dir = tempDir('ur-ast-rename-')
    writeTsRepo(dir, {
      'src/app.ts': [
        'const total = 1',
        'const label = "total"',
        '// total should stay in comments',
        'console.log(total)',
        '',
      ].join('\n'),
    })

    const plan = await planRenameAst({ root: dir, from: 'total', to: 'amount', file: 'src/app.ts' })
    const edits = plan.edits.edits
    expect(edits.length).toBe(2)
    expect(edits.every(e => e.newText === 'amount')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('applyRenameAst updates imports across files', async () => {
    const dir = tempDir('ur-ast-rename-cross-')
    writeTsRepo(dir, {
      'src/a.ts': 'export const total = 1\n',
      'src/b.ts': 'import { total } from "./a"\nconsole.log(total)\n',
    })

    const result = await applyRenameAst({ root: dir, from: 'total', to: 'amount' })
    expect(result.ok).toBe(true)
    expect(result.writtenFiles).toContain('src/a.ts')
    expect(result.writtenFiles).toContain('src/b.ts')
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf-8')).toContain('export const amount = 1')
    expect(readFileSync(join(dir, 'src/b.ts'), 'utf-8')).toContain('import { amount } from "./a"')
    expect(readFileSync(join(dir, 'src/b.ts'), 'utf-8')).toContain('console.log(amount)')
    rmSync(dir, { recursive: true, force: true })
  })

  test('applyRenameAst rolls back when check command fails', async () => {
    const dir = tempDir('ur-ast-rename-rollback-')
    writeTsRepo(dir, {
      'src/a.ts': 'export const total = 1\n',
      'src/b.ts': 'import { total } from "./a"\nconsole.log(total)\n',
    })

    const beforeA = readFileSync(join(dir, 'src/a.ts'), 'utf-8')
    const beforeB = readFileSync(join(dir, 'src/b.ts'), 'utf-8')
    const result = await applyRenameAst({
      root: dir,
      from: 'total',
      to: 'amount',
      checkCommand: 'node -e "process.exit(3)"',
    })

    expect(result.ok).toBe(false)
    expect(result.rolledBack).toBe(true)
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf-8')).toBe(beforeA)
    expect(readFileSync(join(dir, 'src/b.ts'), 'utf-8')).toBe(beforeB)
    rmSync(dir, { recursive: true, force: true })
  })

})
