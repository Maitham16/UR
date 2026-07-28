import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// Releases 1.61.2 through 1.64.0 were uninstallable from npm because a
// version-bump sed rewrote a dependency that happened to sit at the same
// version as UR: playwright-core ^1.61.1 -> ^1.61.2 -> ... -> ^1.64.0, which
// does not exist. Every test passed and the binary worked; only `npm install`
// failed, on other people's machines.

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

test('no dependency range tracks the UR version', () => {
  // A dependency whose range equals our own version is the exact fingerprint
  // of a bump that matched too much. It is theoretically possible for this to
  // be a coincidence; it is overwhelmingly more likely to be the bug.
  const suspicious: string[] = []
  for (const [group, deps] of [
    ['dependencies', pkg.dependencies],
    ['devDependencies', pkg.devDependencies],
  ] as const) {
    for (const [name, range] of Object.entries(deps ?? {})) {
      if (range.replace(/^[\^~]/, '') === pkg.version) {
        suspicious.push(`${group}.${name} = ${range} matches version ${pkg.version}`)
      }
    }
  }
  expect(suspicious).toEqual([])
})

test('playwright-core is pinned to a range that exists', () => {
  // Named explicitly because this is the one that broke, and a regression
  // here is invisible until a user runs npm install.
  const range = pkg.dependencies?.['playwright-core']
  expect(range).toBeDefined()
  expect(range).not.toContain(pkg.version)
})

test('the bump script edits JSON as JSON, not as text', () => {
  // The guard against a repeat: a text substitution over package.json cannot
  // distinguish the version field from a dependency range.
  const script = readFileSync('scripts/version-bump.mjs', 'utf8')
  expect(script).toContain('JSON.parse')
  expect(script).toContain('data.version = next')
  expect(script).not.toMatch(/replace\(\s*new RegExp\(.*version/)
})
