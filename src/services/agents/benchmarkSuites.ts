/**
 * Built-in public benchmark suites for UR.
 *
 * These are small, self-contained eval suites designed to run safely in a
 * fresh worktree. They cover bug fixing, refactoring, test generation,
 * Docker repair, TypeScript migration, and Python package repair.
 */

import { join } from 'node:path'
import { evalsDir, saveSuite, type EvalSuite } from './evals.js'

export type BuiltinSuiteId =
  | 'bug-fix'
  | 'refactor'
  | 'test-gen'
  | 'docker-repair'
  | 'ts-migrate'
  | 'py-package-repair'

const BUILTIN_SUITE_IDS: BuiltinSuiteId[] = [
  'bug-fix',
  'refactor',
  'test-gen',
  'docker-repair',
  'ts-migrate',
  'py-package-repair',
]

import bugFix from './benchmarkSuites/bug-fix.json'
import refactor from './benchmarkSuites/refactor.json'
import testGen from './benchmarkSuites/test-gen.json'
import dockerRepair from './benchmarkSuites/docker-repair.json'
import tsMigrate from './benchmarkSuites/ts-migrate.json'
import pyPackageRepair from './benchmarkSuites/py-package-repair.json'

const BUILTIN_SUITES = {
  'bug-fix': bugFix,
  'refactor': refactor,
  'test-gen': testGen,
  'docker-repair': dockerRepair,
  'ts-migrate': tsMigrate,
  'py-package-repair': pyPackageRepair,
} as Record<BuiltinSuiteId, EvalSuite>

export function listBuiltinSuiteIds(): BuiltinSuiteId[] {
  return [...BUILTIN_SUITE_IDS]
}

export function getBuiltinSuite(id: BuiltinSuiteId): EvalSuite | undefined {
  return BUILTIN_SUITES[id] ? structuredClone(BUILTIN_SUITES[id]) : undefined
}

export function installBuiltinSuite(
  cwd: string,
  id: BuiltinSuiteId,
  options: { force?: boolean } = {},
): { path: string; created: boolean; suite?: EvalSuite } {
  const suite = getBuiltinSuite(id)
  if (!suite) {
    return { path: join(evalsDir(cwd), `${id}.json`), created: false }
  }
  const saved = saveSuite(cwd, suite, { force: options.force })
  return { path: saved.path, created: saved.created, suite }
}
