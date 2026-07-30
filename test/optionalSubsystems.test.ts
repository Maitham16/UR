import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

// query.ts loads two subsystems behind feature flags that this distribution
// does not set: CONTEXT_COLLAPSE and REACTIVE_COMPACT. Neither was inert.
// contextCollapse/index.ts was a stub missing three of the four functions
// query.ts calls, and compact/reactiveCompact.ts did not exist at all — so
// enabling either flag failed at the first turn (TypeError / MODULE_NOT_FOUND)
// rather than degrading to "feature off". query.ts is @ts-nocheck, so tsc
// could not see either mismatch.

const QUERY = readFileSync('src/query.ts', 'utf8')

/** Members reached through `x.` or `x?.` in query.ts. */
function membersUsed(binding: string): string[] {
  const re = new RegExp(`${binding}\\??\\.([a-zA-Z_]+)`, 'g')
  return [...new Set([...QUERY.matchAll(re)].map(m => m[1]!))]
    .filter(name => name !== 'js') // from the require('...js') path
    .sort()
}

function membersExported(file: string): Set<string> {
  const source = readFileSync(file, 'utf8')
  return new Set(
    [
      ...source.matchAll(/export\s+(?:const|function|async function)\s+(\w+)/g),
    ].map(m => m[1]!),
  )
}

test('contextCollapse exports everything query.ts calls on it', () => {
  const exported = membersExported('src/services/contextCollapse/index.ts')
  const missing = membersUsed('contextCollapse').filter(m => !exported.has(m))
  expect(missing).toEqual([])
})

test('reactiveCompact module exists', () => {
  // It was required by path and absent from disk.
  expect(existsSync('src/services/compact/reactiveCompact.ts')).toBe(true)
})

test('reactiveCompact exports everything query.ts calls on it', () => {
  const exported = membersExported('src/services/compact/reactiveCompact.ts')
  const missing = membersUsed('reactiveCompact').filter(m => !exported.has(m))
  expect(missing).toEqual([])
})

test('the disabled stubs report disabled rather than throwing', async () => {
  const collapse = await import('../src/services/contextCollapse/index.ts')
  const reactive = await import('../src/services/compact/reactiveCompact.ts')
  expect(collapse.isContextCollapseEnabled()).toBe(false)
  expect(reactive.isReactiveCompactEnabled()).toBe(false)
  // The results are read for properties by the caller, so they must be
  // objects, not null.
  expect(await collapse.applyCollapsesIfNeeded([])).toBeObject()
  expect(await reactive.tryReactiveCompact()).toBeObject()
})

test('autoCompact — the subsystem that is actually live — is real', () => {
  // The point of the stubs is that this is the working path; if it ever became
  // a stub too, long sessions would silently stop being compacted.
  const source = readFileSync('src/services/compact/autoCompact.ts', 'utf8')
  expect(source.length).toBeGreaterThan(2000)
  expect(source).toContain('export function isAutoCompactEnabled')
})
