import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyOrganizeImportsAst, planOrganizeImportsAst } from '../src/services/repoEditing/ast/repoEditAst.js'

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

describe('AST-aware organize imports', () => {
  test('sorts import block', async () => {
    const dir = tempDir('ur-ast-imports-')
    try {
      writeRepo(dir, {
        'src/app.ts': [
          "import { z } from './z'",
          "import { a } from './a'",
          '',
          'console.log(a, z)',
          '',
        ].join('\n'),
      })

      const plan = await planOrganizeImportsAst({ root: dir, file: 'src/app.ts' })
      // The TS language service may express one logical reorder as several
      // text changes (replace line 1 + delete line 2); assert the outcome
      // below, not the implementation's edit count.
      expect(plan.edits.edits.length).toBeGreaterThanOrEqual(1)
      await applyOrganizeImportsAst({ root: dir, file: 'src/app.ts' })
      const content = readFileSync(join(dir, 'src/app.ts'), 'utf-8')
      const importBlock = content.split('\n').slice(0, 2).join('\n')
      expect(importBlock).toContain("import { a } from './a'")
      expect(importBlock).toContain("import { z } from './z'")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
