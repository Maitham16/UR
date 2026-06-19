import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelCapability } from '../src/commands/model-doctor/model-doctor.ts'
import type { HeadlessRunner } from '../src/services/agents/headlessAgent.ts'
import {
  assessDifficulty,
  needsEscalation,
  planEscalation,
  runWithEscalation,
  selectTiers,
} from '../src/services/agents/escalation.ts'

const FAST: ModelCapability = {
  name: 'qwen2.5-coder:7b',
  size: 4e9,
  advertisedCapabilities: ['tools'],
  contextLength: 32768,
  likelyVision: false,
  likelyCode: true,
}
const ORACLE: ModelCapability = {
  name: 'qwen3-coder:480b-cloud',
  size: 0,
  advertisedCapabilities: ['tools'],
  contextLength: 262144,
  likelyVision: false,
  likelyCode: true,
}

test('selectTiers picks the cloud/large model as oracle and the small one as fast', () => {
  const tiers = selectTiers([FAST, ORACLE])
  expect(tiers.oracle).toBe('qwen3-coder:480b-cloud')
  expect(tiers.fast).toBe('qwen2.5-coder:7b')
  expect(tiers.sameModel).toBe(false)
})

test('selectTiers respects pinned policy', () => {
  const tiers = selectTiers([FAST, ORACLE], { fast: 'pinned-fast', oracle: 'pinned-oracle' })
  expect(tiers.fast).toBe('pinned-fast')
  expect(tiers.oracle).toBe('pinned-oracle')
})

test('selectTiers with a single model marks escalation a no-op', () => {
  const tiers = selectTiers([FAST])
  expect(tiers.sameModel).toBe(true)
  expect(tiers.fast).toBe(tiers.oracle)
})

test('assessDifficulty flags reasoning/debug work as hard', () => {
  expect(assessDifficulty('debug the race condition in the scheduler').hard).toBe(true)
  expect(assessDifficulty('rename a local variable').hard).toBe(false)
})

test('needsEscalation triggers on failure, FAIL verdict, or thin output', () => {
  expect(needsEscalation({ verdict: 'PASS', isError: false, output: 'a'.repeat(80) })).toBe(false)
  expect(needsEscalation({ verdict: 'FAIL', isError: false, output: 'x' })).toBe(true)
  expect(needsEscalation({ verdict: null, isError: true, output: '' })).toBe(true)
  expect(needsEscalation({ verdict: null, isError: false, output: 'too short' })).toBe(true)
})

test('planEscalation starts hard tasks on the oracle', () => {
  expect(planEscalation('optimize the distributed consensus algorithm', [FAST, ORACLE]).startTier).toBe('oracle')
  expect(planEscalation('fix a typo', [FAST, ORACLE]).startTier).toBe('fast')
})

test('runWithEscalation escalates fast->oracle when the cheap run fails', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-esc-'))
  const calls: string[] = []
  const runner: HeadlessRunner = async opts => {
    calls.push(opts.model ?? 'auto')
    return calls.length === 1
      ? { output: 'attempted but wrong', verdict: 'FAIL', isError: false }
      : { output: 'correct solution', verdict: 'PASS', isError: false }
  }
  const result = await runWithEscalation('add a small helper function', {
    cwd: tmp,
    models: [FAST, ORACLE],
    runner,
  })
  expect(result.escalated).toBe(true)
  expect(result.finalTier).toBe('oracle')
  expect(result.attempts.length).toBe(2)
  expect(calls).toEqual(['qwen2.5-coder:7b', 'qwen3-coder:480b-cloud'])
  rmSync(tmp, { recursive: true, force: true })
})

test('runWithEscalation stays on fast when it succeeds', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-esc-'))
  const runner: HeadlessRunner = async () => ({
    output: 'done correctly with enough detail to be meaningful',
    verdict: 'PASS',
    isError: false,
  })
  const result = await runWithEscalation('add a small helper function', {
    cwd: tmp,
    models: [FAST, ORACLE],
    runner,
  })
  expect(result.escalated).toBe(false)
  expect(result.finalTier).toBe('fast')
  rmSync(tmp, { recursive: true, force: true })
})
