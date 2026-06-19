import { expect, test } from 'bun:test'
import { StabilityMonitor } from '../src/stability/stability.ts'
import { rankCauses } from '../src/stability/rootcause.ts'

test('cooldown + oscillation suppression returns containment', () => {
  const m = new StabilityMonitor({ maxFiles: 20, cooldownSteps: 5, maxRepeats: 2, latencyMs: 30000 })
  const call = { name: 'run_shell', arguments: { command: 'ls' } }
  m.tick()
  expect(m.check(call, false).allow).toBe(true)
  m.record(call, false)
  m.tick()
  const v = m.check(call, false)
  expect(v.allow).toBe(false)
  expect(v.containment).toBe(true)
})

test('blast-radius cap blocks the second distinct file', () => {
  const m = new StabilityMonitor({ maxFiles: 1, cooldownSteps: 1, maxRepeats: 9, latencyMs: 30000 })
  m.tick()
  m.record({ name: 'write', arguments: { path: 'a' } }, true, 'a')
  m.tick()
  expect(m.check({ name: 'write', arguments: { path: 'b' } }, true, 'b').allow).toBe(false)
})

test('root-cause ranking', () => {
  expect(['missing_file', 'bad_path']).toContain(rankCauses('ENOENT no such file')[0]!.id)
  expect(rankCauses('blocked by guardrail')[0]!.id).toBe('guardrail')
})
