import { describe, expect, test } from 'bun:test'
import {
  getAdaptiveModelVisibleCount,
  providerNeedsFocusedEffortProbe,
} from '../src/components/ModelPicker.js'

describe('direct model picker layout', () => {
  test('uses the available terminal height for large live catalogues', () => {
    expect(getAdaptiveModelVisibleCount(500, 40)).toBe(24)
    expect(getAdaptiveModelVisibleCount(500, 24)).toBe(8)
  })

  test('keeps a navigable minimum on narrow terminals without exceeding the list', () => {
    expect(getAdaptiveModelVisibleCount(20, 10)).toBe(5)
    expect(getAdaptiveModelVisibleCount(3, 10)).toBe(3)
  })

  test('does not invent a row for an empty or invalid catalogue', () => {
    expect(getAdaptiveModelVisibleCount(0, 24)).toBe(0)
    expect(getAdaptiveModelVisibleCount(Number.NaN, 24)).toBe(0)
  })

  test('probes focused Ollama and llama.cpp models before effort arrows are used', () => {
    expect(providerNeedsFocusedEffortProbe('ollama', 'kimi-k3:cloud')).toBe(true)
    expect(providerNeedsFocusedEffortProbe('llama.cpp', 'local-model')).toBe(true)
    expect(providerNeedsFocusedEffortProbe('openrouter', 'openai/gpt-5.6')).toBe(
      false,
    )
    expect(providerNeedsFocusedEffortProbe('ollama', null)).toBe(false)
  })
})
