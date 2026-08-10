import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeChangeImpact, formatChangeImpact } from '../src/services/repoEditing/changeImpact.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ur-change-impact-'))
}

function writeRepo(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'test'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'src', 'total.ts'), 'export function checkoutTotal(items: number[]): number { return items.length }\n')
  writeFileSync(join(root, 'src', 'checkout.ts'), 'import { checkoutTotal } from "./total"\nexport function checkout() { return checkoutTotal([]) }\n')
  writeFileSync(join(root, 'src', 'app.ts'), 'import { checkout } from "./checkout"\nconsole.log(checkout())\n')
  writeFileSync(join(root, 'test', 'total.test.ts'), 'import { checkoutTotal } from "../src/total"\ntest("checkout total", () => { expect(checkoutTotal([])).toBe(0) })\n')
  writeFileSync(join(root, 'docs', 'checkout.md'), '# Checkout\n`src/total.ts` owns `checkoutTotal`.\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'bun@1.3.0', scripts: { test: 'bun test', typecheck: 'tsc --noEmit', lint: 'eslint .' } }))
}

describe('change-impact analysis', () => {
  test('combines compiler references, dependency blast radius, tests, docs, and commands', async () => {
    const root = tempDir()
    writeRepo(root)
    const report = await analyzeChangeImpact(root, 'checkoutTotal')
    expect(report.targetKind).toBe('symbol')
    expect(report.targetFiles).toContain('src/total.ts')
    expect(report.directDependents).toEqual(expect.arrayContaining(['src/checkout.ts', 'test/total.test.ts']))
    expect(report.transitiveDependents).toContain('src/app.ts')
    expect(report.compilerReferences.map(ref => ref.file)).toContain('src/checkout.ts')
    expect(report.tests).toContain('test/total.test.ts')
    expect(report.docs.map(doc => doc.path)).toContain('docs/checkout.md')
    expect(report.verificationCommands).toContain('bun run typecheck')
    expect(formatChangeImpact(report)).toContain('Compiler references')
    rmSync(root, { recursive: true, force: true })
  })

  test('repo-edit impact returns structured JSON and accepts file targets', async () => {
    const root = tempDir()
    writeRepo(root)
    const { call } = await import('../src/commands/repo-edit/repo-edit.js')
    const result = await runWithCwdOverride(root, () => call('impact src/total.ts --depth 2 --json', {} as never))
    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text')
    const report = JSON.parse(result.value).report
    expect(report.targetKind).toBe('file')
    expect(report.transitiveDependents).toContain('src/app.ts')
    rmSync(root, { recursive: true, force: true })
  })
})
