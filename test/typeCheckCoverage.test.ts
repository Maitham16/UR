import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
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
// History: 223 files at 1.67.0. 73 of them had zero errors once the suppression
// was removed — they were suppressed for no reason at all, hiding 21,503 lines
// of already-valid code. Stripping the remaining 150 surfaces ~870 errors,
// mostly fork artifacts (dead `'external' === 'ant'` build-constant branches),
// but they are not all noise and they are not being checked.
const NOCHECK_BUDGET = 149

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, found)
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) found.push(full)
  }
  return found
}

function suppressedFiles(): string[] {
  return sourceFiles('src').filter(file =>
    /^\/\/\s*@ts-nocheck/m.test(readFileSync(file, 'utf8')),
  )
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
