import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import {
  buildCodeGraph,
  buildRepoIndex,
  findTestsForFile,
  impactOf,
  whereDefined,
  type CallEntry,
  type ConfigEntry,
  type DocEntry,
  type SymbolEntry,
} from '../../utils/codeIndex/index.js'
import { safeParseJSON } from '../../utils/json.js'
import { findCallersAst } from './ast/repoEditAst.js'
import type { SymbolRef } from './ast/types.js'

export type ChangeImpactRisk = 'low' | 'medium' | 'high'

export type ChangeImpactReport = {
  target: string
  targetKind: 'file' | 'symbol'
  definitions: SymbolEntry[]
  targetFiles: string[]
  directDependents: string[]
  transitiveDependents: string[]
  compilerReferences: SymbolRef[]
  heuristicCallers: CallEntry[]
  tests: string[]
  docs: DocEntry[]
  configs: ConfigEntry[]
  risk: ChangeImpactRisk
  riskReasons: string[]
  verificationCommands: string[]
  warnings: string[]
  indexedAt: string
}

function normalizePath(root: string, value: string): string | null {
  const absoluteRoot = resolve(root)
  const absolute = isAbsolute(value) ? resolve(value) : resolve(absoluteRoot, value)
  const rel = relative(absoluteRoot, absolute).split('\\').join('/')
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return null
  return rel
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function relatedTest(test: string, files: string[]): boolean {
  const normalized = test.toLowerCase()
  return files.some(file => {
    const withoutExt = file.toLowerCase().replace(/\.(?:[mc]?[jt]sx?|py|rb|go|rs|java|kt|swift)$/, '')
    const base = withoutExt.split('/').pop() ?? withoutExt
    return base.length >= 3 && (normalized.includes(withoutExt) || normalized.includes(base))
  })
}

function docMatches(doc: DocEntry, target: string, files: string[]): boolean {
  const terms = uniqueSorted([
    target.toLowerCase(),
    ...files.flatMap(file => [file.toLowerCase(), file.toLowerCase().split('/').pop() ?? '']),
  ]).filter(term => term.length >= 3)
  const haystack = [doc.path, doc.title ?? '', ...doc.refs].join('\n').toLowerCase()
  return terms.some(term => haystack.includes(term))
}

function docContentMatches(root: string, doc: DocEntry, target: string, files: string[]): boolean {
  try {
    const path = resolve(root, doc.path)
    const stat = statSync(path)
    if (stat.size > 1_000_000) return false
    const content = readFileSync(path, 'utf8').toLowerCase()
    const terms = uniqueSorted([
      target.toLowerCase(),
      ...files.flatMap(file => [file.toLowerCase(), file.toLowerCase().split('/').pop() ?? '']),
    ]).filter(term => term.length >= 3)
    return terms.some(term => content.includes(term))
  } catch {
    return false
  }
}

function relevantConfig(config: ConfigEntry, files: string[]): boolean {
  if (!config.path.includes('/')) return true
  const configDir = dirname(config.path).split('\\').join('/')
  return files.some(file => file === configDir || file.startsWith(`${configDir}/`) || configDir.startsWith(`${dirname(file)}/`))
}

function packageCommands(root: string, tests: string[]): string[] {
  const file = resolve(root, 'package.json')
  if (!existsSync(file)) return []
  const parsed = safeParseJSON(readFileSync(file, 'utf8'), false) as { packageManager?: unknown; scripts?: unknown } | null
  if (!parsed || !parsed.scripts || typeof parsed.scripts !== 'object') return []
  const scripts = parsed.scripts as Record<string, unknown>
  const packageManager = typeof parsed.packageManager === 'string' ? parsed.packageManager.split('@')[0] : undefined
  const runner = packageManager === 'bun' || existsSync(resolve(root, 'bun.lock')) ? 'bun run' : packageManager === 'pnpm' ? 'pnpm run' : packageManager === 'yarn' ? 'yarn' : 'npm run'
  const commands: string[] = []
  if (tests.length > 0 && runner === 'bun run') commands.push(`bun test ${tests.slice(0, 8).map(test => JSON.stringify(test)).join(' ')}`)
  for (const name of ['typecheck', 'lint', 'test', 'build']) {
    if (typeof scripts[name] === 'string') commands.push(`${runner} ${name}`)
  }
  return uniqueSorted(commands)
}

export async function analyzeChangeImpact(
  root: string,
  target: string,
  options: { maxDepth?: number } = {},
): Promise<ChangeImpactReport> {
  const normalizedTarget = target.trim()
  if (!normalizedTarget || normalizedTarget.length > 500) throw new Error('Impact target is required and must be at most 500 characters')
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 5, 1), 10)
  const [graph, indexes] = await Promise.all([
    buildCodeGraph({ root }),
    buildRepoIndex({ root }),
  ])
  const fileTarget = normalizePath(root, normalizedTarget)
  const targetKind = fileTarget ? 'file' : 'symbol'
  const definitions = targetKind === 'symbol'
    ? indexes.symbols.symbols.filter(symbol => symbol.name === normalizedTarget)
    : indexes.symbols.symbols.filter(symbol => symbol.file === fileTarget)
  const targetFiles = uniqueSorted(
    fileTarget ? [fileTarget] : [
      ...whereDefined(graph, normalizedTarget),
      ...definitions.map(definition => definition.file),
    ],
  )
  const warnings: string[] = []
  if (targetFiles.length === 0) warnings.push(`No definition or repository file found for ${normalizedTarget}.`)
  if (targetKind === 'symbol' && targetFiles.length > 1) warnings.push(`Symbol is defined in ${targetFiles.length} files; review every definition.`)
  const directDependents = uniqueSorted(targetFiles.flatMap(file => graph.importedBy[file] ?? []))
  const transitiveDependents = uniqueSorted(targetFiles.flatMap(file => impactOf(graph, file, maxDepth)))
  let compilerReferences: SymbolRef[] = []
  if (targetKind === 'symbol' && targetFiles.length > 0) {
    try {
      const plan = await findCallersAst({ root, symbol: normalizedTarget })
      compilerReferences = plan.references ?? []
    } catch (error) {
      warnings.push(`Compiler reference analysis was unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const heuristicCallers = targetKind === 'symbol'
    ? indexes.calls.calls.filter(call =>
        call.callee === normalizedTarget &&
        !definitions.some(definition => definition.file === call.file && definition.line === call.line),
      )
    : []
  const affectedFiles = uniqueSorted([...targetFiles, ...transitiveDependents, ...compilerReferences.map(ref => ref.file)])
  const mappedTests = targetFiles.flatMap(file => findTestsForFile(indexes.tests, file).map(test => test.file))
  const testFiles = indexes.repo.files.filter(file => file.kind === 'test').map(file => file.path)
  const tests = uniqueSorted([
    ...affectedFiles.filter(file => indexes.repo.files.find(entry => entry.path === file)?.kind === 'test'),
    ...mappedTests,
    ...testFiles.filter(test => relatedTest(test, affectedFiles)),
  ])
  const docs = indexes.docs.docs
    .filter(doc => docMatches(doc, normalizedTarget, affectedFiles) || docContentMatches(root, doc, normalizedTarget, affectedFiles))
    .slice(0, 50)
  const configs = indexes.configs.configs.filter(config => relevantConfig(config, affectedFiles)).slice(0, 50)
  const riskReasons: string[] = []
  if (targetFiles.length > 1) riskReasons.push('multiple definitions')
  if (directDependents.length > 0) riskReasons.push('has direct dependents')
  if (transitiveDependents.length > 25) riskReasons.push('large transitive dependency blast radius')
  else if (transitiveDependents.length > 5) riskReasons.push('multi-file dependency blast radius')
  if (compilerReferences.length > 20) riskReasons.push('many compiler-resolved call sites')
  if (tests.length === 0 && targetFiles.length > 0) riskReasons.push('no mapped tests')
  if (docs.length > 0) riskReasons.push('documented behavior may require updates')
  if (configs.length > 8) riskReasons.push('crosses multiple configuration surfaces')
  const highRisk = targetFiles.length > 2 || transitiveDependents.length > 25 || compilerReferences.length > 20
  const mediumRisk = riskReasons.length > 0 || directDependents.length > 0
  const risk: ChangeImpactRisk = highRisk ? 'high' : mediumRisk ? 'medium' : 'low'
  const verificationCommands = packageCommands(root, tests)
  if (tests.length === 0) warnings.push('No focused tests were mapped; add or identify coverage before editing.')
  if (verificationCommands.length === 0) warnings.push('No package verification scripts were detected.')
  return {
    target: normalizedTarget,
    targetKind,
    definitions,
    targetFiles,
    directDependents,
    transitiveDependents,
    compilerReferences,
    heuristicCallers,
    tests,
    docs,
    configs,
    risk,
    riskReasons,
    verificationCommands,
    warnings,
    indexedAt: indexes.repo.builtAt,
  }
}

export function formatChangeImpact(report: ChangeImpactReport): string {
  const section = (title: string, values: string[]): string[] => [
    `${title} (${values.length})`,
    ...(values.length ? values.map(value => `  ${value}`) : ['  none']),
  ]
  return [
    `Change impact: ${report.target} [${report.targetKind}]`,
    `Risk: ${report.risk.toUpperCase()}${report.riskReasons.length ? ` — ${report.riskReasons.join('; ')}` : ''}`,
    ...section('Definitions', report.definitions.map(definition => `${definition.file}${definition.line ? `:${definition.line}` : ''} ${definition.kind} ${definition.name}`)),
    ...section('Direct dependents', report.directDependents),
    ...section('Transitive dependents', report.transitiveDependents),
    ...section('Compiler references', report.compilerReferences.map(ref => `${ref.file}:${ref.line}:${ref.column} ${ref.name}`)),
    ...section('Focused tests', report.tests),
    ...section('Related docs', report.docs.map(doc => doc.path)),
    ...section('Relevant config', report.configs.map(config => config.path)),
    ...section('Verification plan', report.verificationCommands),
    ...report.warnings.map(warning => `WARN: ${warning}`),
  ].join('\n')
}
