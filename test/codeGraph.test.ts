import { expect, test } from 'bun:test'
import {
  buildGraphFromFiles,
  dependenciesOf,
  extractImports,
  extractSymbols,
  graphSearch,
  impactOf,
  resolveImport,
  whereDefined,
  type SourceFile,
} from '../src/utils/codeIndex/graph.ts'

test('extractImports captures es, require, dynamic, and python forms', () => {
  const imports = extractImports(
    [
      "import { a } from './a.js'",
      "export { b } from './b'",
      "const c = require('./c')",
      "const d = await import('./d.js')",
      "import 'side-effect'",
      'from .pkg import thing',
    ].join('\n'),
  )
  expect(imports).toContain('./a.js')
  expect(imports).toContain('./b')
  expect(imports).toContain('./c')
  expect(imports).toContain('./d.js')
  expect(imports).toContain('side-effect')
  expect(imports).toContain('.pkg')
})

test('extractSymbols captures exported and top-level definitions', () => {
  const symbols = extractSymbols(
    [
      'export function alpha() {}',
      'export class Beta {}',
      'export const gamma = 1',
      'function delta() {}',
      'def epsilon():',
    ].join('\n'),
  )
  expect(symbols.sort()).toEqual(['Beta', 'alpha', 'delta', 'epsilon', 'gamma'])
})

test('resolveImport maps .js specifiers to .ts files and index files', () => {
  const fileSet = new Set(['src/a.ts', 'src/dir/index.ts'])
  expect(resolveImport('src/main.ts', './a.js', fileSet)).toBe('src/a.ts')
  expect(resolveImport('src/main.ts', './dir', fileSet)).toBe('src/dir/index.ts')
  expect(resolveImport('src/main.ts', 'lodash', fileSet)).toBeNull()
})

test('resolveImport handles python relative dots', () => {
  const fileSet = new Set(['pkg/sub/mod.py', 'pkg/util.py'])
  expect(resolveImport('pkg/sub/main.py', '.mod', fileSet)).toBe('pkg/sub/mod.py')
  expect(resolveImport('pkg/sub/main.py', '..util', fileSet)).toBe('pkg/util.py')
})

const SOURCES: SourceFile[] = [
  { path: 'src/util.ts', content: 'export function helper() {}' },
  { path: 'src/service.ts', content: "import { helper } from './util.js'\nexport class Service {}" },
  { path: 'src/cli.ts', content: "import { Service } from './service.js'\nexport function main() {}" },
]

test('buildGraphFromFiles wires imports and reverse edges', () => {
  const graph = buildGraphFromFiles(SOURCES)
  expect(graph.imports['src/service.ts']).toEqual(['src/util.ts'])
  expect(graph.importedBy['src/util.ts']).toEqual(['src/service.ts'])
  expect(whereDefined(graph, 'Service')).toEqual(['src/service.ts'])
})

test('impactOf returns the transitive blast radius', () => {
  const graph = buildGraphFromFiles(SOURCES)
  // util is imported by service, which is imported by cli.
  expect(impactOf(graph, 'src/util.ts')).toEqual(['src/cli.ts', 'src/service.ts'])
  expect(dependenciesOf(graph, 'src/cli.ts')).toEqual(['src/service.ts', 'src/util.ts'])
})

test('graphSearch matches symbols and expands to neighbors', () => {
  const graph = buildGraphFromFiles(SOURCES)
  const hits = graphSearch(graph, 'service')
  expect(hits[0]!.file).toBe('src/service.ts')
  expect(hits.some(h => h.file === 'src/util.ts' || h.file === 'src/cli.ts')).toBe(true)
})
