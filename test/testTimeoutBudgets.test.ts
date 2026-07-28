import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The release gate runs `bun test --timeout 120000`, but a per-test budget
// silently overrides that global. Two tests declared 15s and 20s budgets that
// their own bodies exceeded on a 2-core CI runner, so the gate failed on
// timing while every assertion passed — a red release with no real defect.
//
// A per-test budget is only worth setting to assert something *is* fast. These
// tests build TypeScript programs and spawn the CLI two dozen times; they are
// slow by nature and the budget was never the point.

const FLOOR_MS = 60_000

// `}, 5)` and `}, 401)` are ordinary call arguments, not timeouts. Requiring
// five digits keeps the scan to values that are plausibly milliseconds.
const TRAILING_NUMBER = /\}\s*,\s*(\d[\d_]{4,})\s*\)/g

test('no test declares a budget below the release gate floor', () => {
  const offenders: string[] = []
  for (const file of readdirSync('test').filter(f => f.endsWith('.test.ts'))) {
    const source = readFileSync(join('test', file), 'utf8')
    for (const match of source.matchAll(TRAILING_NUMBER)) {
      const budget = Number(match[1]!.replace(/_/g, ''))
      if (budget < FLOOR_MS) {
        offenders.push(`${file}: ${match[1]}`)
      }
    }
  }
  // Anything listed here would fail the release gate on a slow runner while
  // passing locally — the hardest kind of failure to attribute.
  expect(offenders).toEqual([])
})
