import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  describeVisionSupport,
  nameSuggestsVision,
  resolveVisionSupport,
  shouldSendImages,
} from '../src/utils/model/visionCapability.ts'
import { advertisedCapabilities } from '../src/commands/model-doctor/model-doctor.ts'

// Three different answers to "can this model see" disagreed. The Ollama
// adapter's modelCapabilityEnabled returned `has(x) ?? true`, so an
// unadvertised model was assumed capable; model-doctor matched names; the
// router read a precomputed flag. The binary shape was the bug — absence of
// evidence was reported as evidence, in opposite directions.

test('an advertised capability list is authoritative both ways', () => {
  expect(resolveVisionSupport('anything', new Set(['vision', 'tools']))).toBe(
    'supported',
  )
  // A server that lists capabilities and omits vision really lacks it.
  expect(resolveVisionSupport('anything', new Set(['tools']))).toBe(
    'unsupported',
  )
})

test('an unadvertised model is unknown, not unsupported', () => {
  // This is the case that produced the wrong advice: kimi-k2.7-code:cloud
  // returned no capabilities and was told it had no vision support.
  expect(resolveVisionSupport('kimi-k2.7-code:cloud', null)).toBe('unknown')
  expect(resolveVisionSupport('kimi-k2.7-code:cloud', undefined)).toBe(
    'unknown',
  )
})

test('an explicitly empty capability list is an authoritative no', () => {
  expect(resolveVisionSupport('kimi-k2.7-code:cloud', new Set())).toBe(
    'unsupported',
  )
  // A name hint cannot overrule what the provider explicitly advertised.
  expect(resolveVisionSupport('llava:13b', new Set())).toBe('unsupported')
})

test('model-doctor preserves absent versus explicitly empty capability lists', () => {
  expect(advertisedCapabilities(undefined)).toBeNull()
  expect(advertisedCapabilities({})).toBeNull()
  expect(advertisedCapabilities({ capabilities: [] })).toEqual([])
  expect(advertisedCapabilities({ capabilities: [42, null] })).toBeNull()
  expect(
    advertisedCapabilities({
      capabilities: [' tools ', '', 42, 'vision', 'vision'],
    }),
  ).toEqual(['tools', 'vision'])
})

test('a recognised vision name confirms support without a capability list', () => {
  for (const model of [
    'llava:13b',
    'llama3.2-vision:11b',
    'moondream',
    'minicpm-v',
    'qwen2.5vl:7b',
    'gemma3:12b',
  ]) {
    expect(resolveVisionSupport(model, null)).toBe('supported')
    expect(nameSuggestsVision(model)).toBe(true)
  }
})

test('an unrecognised name never rules vision out', () => {
  // Name matching can confirm support; it cannot deny it.
  expect(nameSuggestsVision('some-new-model')).toBe(false)
  expect(resolveVisionSupport('some-new-model', null)).toBe('unknown')
})

test('images are withheld only on a confirmed no', () => {
  expect(shouldSendImages('supported')).toBe(true)
  // Refusing to send on a maybe would break every server without a
  // capabilities endpoint; a model that cannot use them ignores them.
  expect(shouldSendImages('unknown')).toBe(true)
  expect(shouldSendImages('unsupported')).toBe(false)
})

test('the two failure messages give opposite advice, correctly', () => {
  const no = describeVisionSupport('unsupported', 'qwen2.5-coder', 1)
  expect(no).toContain('cannot see images')
  expect(no).toContain('/model')

  const maybe = describeVisionSupport('unknown', 'kimi-k2.7-code:cloud', 1)
  // Must not assert a missing capability it never verified.
  expect(maybe).not.toContain('cannot see images')
  expect(maybe).toContain('could not be confirmed')
  expect(maybe).toContain('say')
})

test('a confirmed model gets no warning noise', () => {
  expect(describeVisionSupport('supported', 'llava', 3)).toBeNull()
  expect(describeVisionSupport('unsupported', 'x', 0)).toBeNull()
})

test('the adapter and the doctor both use the shared resolver', () => {
  // The whole point is that one answer exists. A second private copy would
  // reintroduce the drift.
  const ollama = readFileSync('src/services/api/ollama.ts', 'utf8')
  expect(ollama).toContain('resolveVisionSupport')
  expect(ollama).toContain('shouldSendImages')
  const doctor = readFileSync(
    'src/commands/model-doctor/model-doctor.ts',
    'utf8',
  )
  expect(doctor).toContain('resolveVisionSupport')
  expect(doctor).not.toContain("lowered.includes('llava')")
})
