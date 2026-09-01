import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = path.resolve(import.meta.dir, '..')

test('every source file that calls getCwd has a local binding', () => {
  const offenders: string[] = []
  const files = new Bun.Glob('src/**/*.{ts,tsx}').scanSync(repoRoot)

  for (const relative of files) {
    const sourceText = readFileSync(path.join(repoRoot, relative), 'utf8')
    const source = ts.createSourceFile(
      relative,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    let callsGetCwd = false
    let bindsGetCwd = false

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'getCwd'
      ) {
        callsGetCwd = true
      }

      if (
        (ts.isImportSpecifier(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isVariableDeclaration(node) ||
          ts.isParameter(node)) &&
        node.name &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'getCwd'
      ) {
        bindsGetCwd = true
      }

      ts.forEachChild(node, visit)
    }

    visit(source)
    if (callsGetCwd && !bindsGetCwd) {
      offenders.push(relative)
    }
  }

  // This catches unresolved runtime identifiers even in legacy @ts-nocheck
  // files, which is how runAgent.ts shipped a bare getCwd() call.
  expect(offenders).toEqual([])
})
