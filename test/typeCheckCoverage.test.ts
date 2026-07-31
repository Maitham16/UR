import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// `tsc --noEmit` passing means much less than it looks like on this codebase:
// files carrying `@ts-nocheck` are skipped entirely. Every genuine bug found in
// the 1.66–1.68 audit lived in that blind spot — a stub missing three functions
// its caller invoked, a module required by path that did not exist on disk, and
// an undeclared dependency that silently disabled all syntax highlighting.
//
// This is a ratchet, not a target. The budget may fall, never rise. Removing a
// suppression is the only way to move it, which makes the debt visible in a
// diff instead of accumulating silently.
//
// History: 223 files at 1.67.0 -> 132 at 1.68.15. Almost none of it was
// file-by-file work; the errors cluster hard by cause:
//   - 73 files had zero errors once unsuppressed — suppressed for no reason.
//   - useRegisterOverlay declared an argument its own body defaulted, so every
//     caller passing one argument errored. One `?` cleared 10.
//   - Four files declared *empty* interfaces under "Stub: not included in
//     leaked source". An empty interface means "has no members" to TypeScript,
//     not "shape unknown", so every property access on one was an error. Giving
//     them the shapes their consumers use cleared 258 between them.
// 563 errors remain. Group by error signature before opening files.
const NOCHECK_BUDGET = 132

function sourceFiles(dir: string, found: string[] = []): string[] {
  // withFileTypes avoids a statSync (and its file handle) per entry.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, found)
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) found.push(full)
  }
  return found
}

// Computed once. Each test calling this independently meant three full walks
// of ~2400 files, and with four parallel workers that contributed to ENFILE
// ("file table overflow") on machines with a low ulimit -n — which then fails
// unrelated tests with misleading "Cannot find module" errors.
let suppressedCache: string[] | undefined

function suppressedFiles(): string[] {
  suppressedCache ??= sourceFiles('src').filter(file =>
    /^\/\/\s*@ts-nocheck/m.test(readFileSync(file, 'utf8')),
  )
  return suppressedCache
}

test('the @ts-nocheck budget does not grow', () => {
  const suppressed = suppressedFiles()
  expect(suppressed.length).toBeLessThanOrEqual(NOCHECK_BUDGET)
})

test('the budget is not left slack after files are fixed', () => {
  // If the real count drops well below the budget, lower the constant in the
  // same change — otherwise the ratchet quietly stops ratcheting.
  const suppressed = suppressedFiles()
  expect(NOCHECK_BUDGET - suppressed.length).toBeLessThanOrEqual(10)
})

test('the main loop and permission code are still on the list', () => {
  // Not an endorsement — a reminder. These are the highest-consequence files
  // still unchecked, and they should be the next ones off it.
  const suppressed = new Set(suppressedFiles())
  const highValue = [
    'src/query.ts',
    'src/utils/permissions/permissions.ts',
    'src/utils/permissions/filesystem.ts',
    'src/services/tools/toolExecution.ts',
  ]
  const stillSuppressed = highValue.filter(f => suppressed.has(f))
  // When this list empties, delete the test.
  expect(stillSuppressed.length).toBeGreaterThan(0)
})
