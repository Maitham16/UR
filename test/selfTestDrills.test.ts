import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DRILLS } from '../src/services/agents/selfTest.ts'

// Every serious defect this repo shipped recently passed its unit tests: a
// screenshot returned as a byte count, images dropped by the adapter, a CI
// gate that printed FAILED and exited 0, a memory store reporting "verified"
// after checking nothing. In each case the module was right and something
// between it and the user was wrong. These drills spawn the real binary.

function selftest(env: Record<string, string> = {}) {
  return spawnSync('node', ['./bin/ur.js', 'selftest', 'run'], {
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, ...env },
  })
}

test('every automated drill passes against the shipped binary', () => {
  const result = selftest()
  expect(result.stdout).toContain('5/5 passed')
  expect(result.status).toBe(0)
}, 240_000)

test('the drills actually fail when the binary is broken', () => {
  // A self-test that cannot fail is decoration. Point it at a binary that
  // does not exist and every drill must report failure and exit non-zero.
  const result = selftest({ UR_BIN: './bin/does-not-exist.js' })
  expect(result.stdout).toContain('0/5 passed')
  expect(result.status).toBe(1)
}, 240_000)

test('manual drills state an observable expectation, not a vibe', () => {
  // "It seemed fine" is how the screenshot bug survived its first report.
  const manual = DRILLS.filter(drill => drill.kind === 'manual')
  expect(manual.length).toBeGreaterThan(0)
  for (const drill of manual) {
    expect(drill.action.length).toBeGreaterThan(20)
    expect(drill.expect.length).toBeGreaterThan(20)
    // Each drill exists because something real broke; the rationale keeps it
    // from being deleted as noise later.
    expect(drill.rationale.length).toBeGreaterThan(20)
  }
})

test('each drill covers a feature that shipped broken or is unproven', () => {
  const features = new Set(DRILLS.map(drill => drill.feature))
  for (const feature of ['Computer', 'sources', 'memory-integrity', 'grade-trajectory']) {
    expect(features).toContain(feature)
  }
})

test('the fan-out drill exercises the path the limit is reachable on', () => {
  // The original drill asked for 30 agents in one turn. MAX_CONCURRENT_TOOLS
  // caps a turn at 8, so agents.maxConcurrent (20) never got a chance and the
  // run reported an unrelated limit — which I then misread as the governor
  // being unreachable. It is reachable, by nesting.
  const drill = DRILLS.find(d => d.id === 'fan-out-limit')!
  expect(drill.action.toUpperCase()).toContain('NESTED')
  expect(drill.rationale).toContain('MAX_CONCURRENT_TOOLS')
})

test('pruning has a drill, since no automated check can reach it', () => {
  const drill = DRILLS.find(d => d.id === 'tool-result-pruning')
  expect(drill).toBeDefined()
  expect(drill!.kind).toBe('manual')
  expect(drill!.expect).toContain('pruned')
})

test('drills work from outside the repo, where users actually run them', () => {
  // runCli resolved './bin/ur.js' against the current directory, so every
  // drill failed the moment `ur selftest` ran anywhere but the UR repo —
  // reporting 0/5 with empty details, which looks like five broken features
  // rather than one broken path. Every existing test ran from the repo root,
  // where that relative path happens to exist, so all of them stayed green.
  const elsewhere = mkdtempSync(join(tmpdir(), 'ur-cwd-'))
  const result = spawnSync(
    process.execPath,
    [resolve('./bin/ur.js'), 'selftest', 'run'],
    { encoding: 'utf8', timeout: 240_000, cwd: elsewhere },
  )
  expect(result.stdout).toContain('5/5 passed')
  expect(result.status).toBe(0)
}, 300_000)

test('the binary is resolved from the running process, not the cwd', () => {
  const source = readFileSync('src/services/agents/selfTest.ts', 'utf8')
  expect(source).toContain('process.execPath')
  expect(source).toContain('process.argv[1]')
  // A bare relative path is the defect; it must not be the primary source.
  expect(source).not.toContain("spawnSync('node', [process.env.UR_BIN")
})
