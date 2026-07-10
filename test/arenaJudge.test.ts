import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HeadlessRunner } from '../src/services/agents/headlessAgent.ts'
import { judge, runArena, scoreCandidate, type Candidate } from '../src/services/agents/arena.ts'

const cleanDiff = [
  '+++ b/foo.ts',
  '@@ -0,0 +1,2 @@',
  '+export const x = 1',
  '+export const y = 2',
].join('\n')

// Build the fake key at runtime so the literal never lands in source (and the
// repo secret scanner stays quiet); reviewDiff still sees the full token.
const fakeAwsKey = 'AKIA' + 'IOSFODNN7EXAMPLE'
const secretDiff = [
  '+++ b/config.ts',
  '@@ -0,0 +1,1 @@',
  `+const apiKey = "${fakeAwsKey}"`,
].join('\n')

test('scoreCandidate rewards a clean passing diff', () => {
  const scored = scoreCandidate({
    id: 'a',
    diff: cleanDiff,
    output: '',
    verdict: 'PASS',
    isError: false,
  })
  expect(scored.changedLines).toBe(2)
  expect(scored.blocking).toBe(0)
  expect(scored.score).toBeGreaterThan(5)
})

test('scoreCandidate sinks a candidate that commits a secret', () => {
  const scored = scoreCandidate({
    id: 'b',
    diff: secretDiff,
    output: '',
    verdict: 'PASS',
    isError: false,
  })
  expect(scored.blocking).toBeGreaterThan(0)
  expect(scored.score).toBeLessThan(2)
})

test('judge ranks the clean candidate first and skips empty diffs', () => {
  const candidates: Candidate[] = [
    { id: 'a', diff: cleanDiff, output: '', verdict: 'PASS', isError: false },
    { id: 'b', diff: secretDiff, output: '', verdict: 'PASS', isError: false },
    { id: 'c', diff: '', output: '', verdict: null, isError: false },
  ]
  const { ranked, winner } = judge(candidates)
  expect(winner?.id).toBe('a')
  expect(ranked[0].id).toBe('a')
})

test('judge fails closed when every changed candidate failed review', () => {
  const { winner } = judge([
    { id: 'failed', diff: cleanDiff, output: '', verdict: 'FAIL', isError: false },
    { id: 'blocked', diff: secretDiff, output: '', verdict: 'PASS', isError: false },
  ])
  expect(winner).toBeNull()
})

test('runArena does not select a winner when injected runners produce no diff', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-arena-'))
  let n = 0
  const verdicts = ['PASS', 'FAIL', 'FAIL']
  const runner: HeadlessRunner = async () => {
    const verdict = verdicts[n++] as 'PASS' | 'FAIL'
    return { output: `candidate ${n}`, verdict, isError: false }
  }
  const result = await runArena('implement the thing', {
    cwd: tmp,
    agents: 3,
    runner,
  })
  expect(result.candidates.length).toBe(3)
  expect(result.candidates.filter(c => c.verdict === 'PASS').length).toBe(1)
  expect(result.winner).toBeNull()
  rmSync(tmp, { recursive: true, force: true })
})
