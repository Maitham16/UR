import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCallersAst, findUnusedAst } from '../src/services/repoEditing/ast/repoEditAst.js'
import { tsFindUnused } from '../src/services/repoEditing/ast/typescriptEngine.js'
import { loadProgram } from '../src/services/repoEditing/ast/typescriptEngine.js'

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

describe('AST-aware read operations', () => {
  test('findUnusedAst reports unused variable', async () => {
    const dir = tempDir('ur-ast-unused-')
    writeRepo(dir, {
      'src/app.ts': 'const unused = 1\nconst used = 2\nconsole.log(used)\n',
    })

    const ctx = loadProgram(dir, ['src/app.ts'])
    const refs = tsFindUnused(ctx, { root: dir, file: 'src/app.ts' })
    expect(refs.map(r => r.name)).toContain('unused')
    rmSync(dir, { recursive: true, force: true })
  })

  test('findCallersAst reports direct callers', async () => {
    const dir = tempDir('ur-ast-callers-')
    writeRepo(dir, {
      'src/app.ts': 'function greet() {}\nfunction inner() { greet() }\ninner()\n',
    })

    const plan = await findCallersAst({ root: dir, symbol: 'greet', file: 'src/app.ts' })
    expect(plan.affectedFiles).toContain('src/app.ts')
    rmSync(dir, { recursive: true, force: true })
  })
})
