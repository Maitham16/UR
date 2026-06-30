import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyWorkspaceEdit } from '../src/services/repoEditing/ast/workspaceEdit.js'
import { loadProgram, tsRenameSymbol } from '../src/services/repoEditing/ast/typescriptEngine.js'

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

describe('typescript engine', () => {
  test('finds identifiers and computes edits for simple rename', () => {
    const dir = tempDir('ur-ts-engine-simple-')
    writeRepo(dir, {
      'app.ts': 'const total = 1\nconsole.log(total)\n',
    })
    const ctx = loadProgram(dir, ['app.ts'])
    const edit = tsRenameSymbol(ctx, { root: dir, from: 'total', to: 'amount' })
    expect(edit.edits.length).toBe(2)
    expect(edit.edits.every(e => e.newText === 'amount')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('applies cross-file rename edits', () => {
    const dir = tempDir('ur-ts-engine-cross-')
    writeRepo(dir, {
      'src/a.ts': 'export const total = 1\n',
      'src/b.ts': 'import { total } from "./a"\nconsole.log(total)\n',
    })
    const ctx = loadProgram(dir, ['src/a.ts', 'src/b.ts'])
    const edit = tsRenameSymbol(ctx, { root: dir, from: 'total', to: 'amount' })
    const result = applyWorkspaceEdit(dir, edit)
    expect(result.writtenFiles.sort()).toEqual(['src/a.ts', 'src/b.ts'])
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf-8')).toContain('export const amount = 1')
    expect(readFileSync(join(dir, 'src/b.ts'), 'utf-8')).toContain('import { amount } from "./a"')
    expect(readFileSync(join(dir, 'src/b.ts'), 'utf-8')).toContain('console.log(amount)')
    rmSync(dir, { recursive: true, force: true })
  })

  test('does not touch comments or strings', () => {
    const dir = tempDir('ur-ts-engine-literal-')
    writeRepo(dir, {
      'app.ts': [
        'const total = 1',
        'const label = "total"',
        '// total should stay in comments',
        'console.log(total)',
        '',
      ].join('\n'),
    })
    const ctx = loadProgram(dir, ['app.ts'])
    const edit = tsRenameSymbol(ctx, { root: dir, from: 'total', to: 'amount' })
    const result = applyWorkspaceEdit(dir, edit)
    const content = readFileSync(join(dir, 'app.ts'), 'utf-8')
    expect(content).toContain('const amount = 1')
    expect(content).toContain('"total"')
    expect(content).toContain('// total should stay in comments')
    expect(result.writtenFiles).toEqual(['app.ts'])
    rmSync(dir, { recursive: true, force: true })
  })

})
