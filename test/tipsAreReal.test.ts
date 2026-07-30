import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// A tip advertised `/mobile to use UR from the UR app on your phone`. There is
// no /mobile command and no app. Another pointed at ur.ai/web, a domain with
// no DNS record. Tips are the first thing a new user reads, so a tip for
// something that does not exist is the worst place to be wrong.

const TIPS = readFileSync('src/services/tips/tipRegistry.ts', 'utf8')
const REFERENCE = readFileSync('technical/03-slash-commands.md', 'utf8')

/** Slash commands as they appear in user-facing tip text. */
function citedCommands(): string[] {
  const lines = TIPS.split('\n').filter(line =>
    /content:|return `|=> `/.test(line) || /['"`]\//.test(line),
  )
  const cited = new Set<string>()
  for (const line of lines) {
    for (const match of line.matchAll(/[`'" ]\/([a-z][a-z0-9-]{2,})/g)) {
      cited.add(match[1]!)
    }
  }
  return [...cited].sort()
}

test('every command a tip advertises actually exists', () => {
  const missing = citedCommands().filter(
    name => !REFERENCE.includes(`\`/${name}`),
  )
  expect(missing).toEqual([])
})

test('the check reads real tips, so it cannot pass vacuously', () => {
  // An empty citation list would make the assertion above meaningless.
  const cited = citedCommands()
  expect(cited.length).toBeGreaterThan(20)
  // Canaries must be commands actually cited. `model` was a bad pick: the
  // pattern matches greedily, so `/model-route` yields "model-route" and bare
  // "model" never appears.
  expect(cited).toContain('spec')
  expect(cited).toContain('trace')
})

test('no tip points at a domain UR does not own', () => {
  // Tips are the first thing a new user reads, so a dead link there is the
  // worst place to be wrong. ur.ai was never registered. ur.com is being
  // acquired but is not serving yet — relax this deliberately once it is,
  // rather than by accident.
  //
  // An earlier version of this comment asserted both domains "have no DNS
  // records". That came from a lookup run in an environment with no DNS at
  // all, where github.com fails identically, so it was never evidence.
  expect(TIPS).not.toMatch(/ur\.(ai|com)/)
})

test('the removed tips stay removed', () => {
  expect(TIPS).not.toContain('/mobile')
  expect(TIPS).not.toContain('ur.ai/web')
})
