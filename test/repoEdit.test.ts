import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import {
  applyRename,
  buildRepoEditIndex,
  planRename,
  repoEditIndexPath,
  searchRepoEditIndex,
} from '../src/services/repoEditing/reliableRepoEdit.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('reliable repo editing', () => {
  test('builds a searchable file and symbol index', () => {
    const dir = tempDir('ur-repo-edit-index-')
    mkdirSync(join(dir, 'src'))
    writeFileSync(
      join(dir, 'src', 'checkout.ts'),
      'export function checkoutTotal(items: number[]): number {\n  return items.length\n}\n',
    )

    const index = buildRepoEditIndex(dir)
    expect(existsSync(repoEditIndexPath(dir))).toBe(true)
    expect(index.files.map(file => file.path)).toContain('src/checkout.ts')
    expect(index.files.flatMap(file => file.symbols.map(symbol => symbol.name))).toContain(
      'checkoutTotal',
    )

    const hits = searchRepoEditIndex(dir, 'checkoutTotal', index)
    expect(hits[0].file).toBe('src/checkout.ts')
    expect(hits[0].reasons).toContain('symbol:checkoutTotal')
    rmSync(dir, { recursive: true, force: true })
  })

  test('plans AST-aware renames without touching comments or strings', () => {
    const dir = tempDir('ur-repo-edit-plan-')
    mkdirSync(join(dir, 'src'))
    writeFileSync(
      join(dir, 'src', 'app.ts'),
      [
        'const total = 1',
        'const label = "total"',
        '// total should stay in comments',
        'console.log(total)',
        '',
      ].join('\n'),
    )

    const plan = planRename(dir, 'total', 'amount')
    expect(plan.totalOccurrences).toBe(2)
    expect(plan.files[0].newContent).toContain('const amount = 1')
    expect(plan.files[0].newContent).toContain('"total"')
    expect(plan.files[0].newContent).toContain('// total should stay in comments')
    expect(plan.files[0].patch).toContain('const amount = 1')
    rmSync(dir, { recursive: true, force: true })
  })

  test('rolls back every changed file when the check command fails', async () => {
    const dir = tempDir('ur-repo-edit-rollback-')
    mkdirSync(join(dir, 'src'))
    const first = join(dir, 'src', 'a.ts')
    const second = join(dir, 'src', 'b.ts')
    writeFileSync(first, 'export const total = 1\n')
    writeFileSync(second, 'import { total } from "./a"\nconsole.log(total)\n')

    const beforeFirst = readFileSync(first, 'utf-8')
    const beforeSecond = readFileSync(second, 'utf-8')
    const result = await applyRename(dir, 'total', 'amount', {
      checkCommand: 'node -e "process.exit(3)"',
    })

    expect(result.ok).toBe(false)
    expect(result.rolledBack).toBe(true)
    expect(readFileSync(first, 'utf-8')).toBe(beforeFirst)
    expect(readFileSync(second, 'utf-8')).toBe(beforeSecond)
    rmSync(dir, { recursive: true, force: true })
  })

  test('repo-edit command previews patches without writing', async () => {
    const dir = tempDir('ur-repo-edit-command-')
    mkdirSync(join(dir, 'src'))
    const file = join(dir, 'src', 'app.ts')
    writeFileSync(file, 'const total = 1\nconsole.log(total)\n')
    const { call } = await import('../src/commands/repo-edit/repo-edit.js')

    const result = await runWithCwdOverride(dir, () =>
      call('preview rename total --to amount', {} as never),
    )

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text')
    expect(result.value).toContain('const amount = 1')
    expect(readFileSync(file, 'utf-8')).toContain('const total = 1')
    rmSync(dir, { recursive: true, force: true })
  })
})
