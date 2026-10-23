import { afterEach, expect, test } from 'bun:test'
import { parseOllamaThinkingCapabilities } from '../src/services/providers/ollamaCapabilities.js'
import { cacheProviderModelsForProvider, clearProviderModelCacheForTests, ensureProviderReasoningCapabilitiesForModel } from '../src/services/providers/providerRegistry.js'
import { toOllamaChatRequest } from '../src/services/api/ollama.js'
import { cacheOllamaModelMetadata, clearOllamaModelMetadataCacheForTests } from '../src/utils/model/ollamaModels.js'
import { getSupportedEffortLevelsForModel, getProviderEffortWireValue, getDefaultEffortForModel, resolveProviderEffortLevel, parseEffortValue } from '../src/utils/effort.js'
import { providerSupportsThinkingToggle } from '../src/utils/thinking.js'

afterEach(() => { clearProviderModelCacheForTests(); clearOllamaModelMetadataCacheForTests() })
const baseUrl = 'http://127.0.0.1:13245'
const model = 'fixture-reasoner:cloud'
const capabilities = new Set(['completion', 'tools', 'thinking'])
function request(thinking?: { type: string }, effort?: string) {
  return toOllamaChatRequest({ model, messages: [], ...(thinking ? { thinking } : {}),
    ...(effort ? { output_config: { effort } } : {}) } as never, false, capabilities, baseUrl)
}

test('Ollama /show values provide exact model-scoped graded controls without name inference', async () => {
  const reasoning = await ensureProviderReasoningCapabilitiesForModel('ollama', model, {
    settings: { provider: { active: 'ollama', baseUrls: { ollama: baseUrl } } },
    adapters: { fetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body)).model).toBe(model)
      return Response.json({ thinking: { values: ['low', 'medium', 'high'], default: 'medium' } })
    } },
  })
  expect(reasoning).toMatchObject({ supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', mandatory: true })
})

test('named-only thinking never receives unsupported boolean controls', () => {
  const value = { thinking: { values: ['low', 'medium', 'high'], default: 'medium' } }
  const reasoning = parseOllamaThinkingCapabilities(value)!
  cacheProviderModelsForProvider('ollama', [{ id: model, displayName: model, description: 'fixture', reasoning }])
  cacheOllamaModelMetadata(model, value, [], baseUrl)
  expect(getSupportedEffortLevelsForModel(model, 'ollama')).toEqual(['low', 'medium', 'high'])
  expect(providerSupportsThinkingToggle('ollama', model)).toBe(false)
  expect(request({ type: 'adaptive' }, 'high').think).toBe('high')
  expect(request({ type: 'disabled' }).think).toBeUndefined()
  expect(request({ type: 'adaptive' }).think).toBe('medium')
})

test('boolean and mixed controls preserve explicit off and provider defaults', () => {
  cacheOllamaModelMetadata(model, { thinking: { values: [false, true], default: false } }, [], baseUrl)
  expect(request({ type: 'adaptive' }).think).toBe(true)
  expect(request({ type: 'disabled' }, 'high').think).toBe(false)
  expect(request().think).toBeUndefined()
  cacheOllamaModelMetadata(model, { thinking: { values: [false, 'low', 'high'], default: false } }, [], baseUrl)
  expect(request({ type: 'adaptive' }, 'high').think).toBe('high')
  expect(request({ type: 'disabled' }).think).toBe(false)
  expect(request({ type: 'adaptive' }).think).toBe('low')
})

test('false-only metadata overrides a stale thinking capability and stays endpoint-scoped', () => {
  cacheOllamaModelMetadata(model, { thinking: { values: [false], default: false } }, [], baseUrl)
  expect(request({ type: 'adaptive' }, 'high').think).toBeUndefined()
  const reasoning = parseOllamaThinkingCapabilities({ thinking: { values: [false], default: false } })
  expect(reasoning).toMatchObject({ supportsThinking: false, mandatory: false, supportedEfforts: [] })
  expect(toOllamaChatRequest({ model, messages: [], thinking: { type: 'adaptive' } } as never,
    false, capabilities, 'http://127.0.0.1:13246').think).toBe(true)
})

test('transport preserves exact provider spelling and translates only established aliases', () => {
  const value = { thinking: { values: ['low', 'max', 'Deep'], default: 'low' } }
  cacheOllamaModelMetadata(model, value, [], baseUrl)
  cacheProviderModelsForProvider('ollama', [{ id: model, displayName: model, description: 'fixture', reasoning: parseOllamaThinkingCapabilities(value) }])
  expect(request({ type: 'adaptive' }, 'ultra').think).toBe('max')
  expect(getSupportedEffortLevelsForModel(model, 'ollama')).toEqual(['low', 'max', 'ultra', 'deep'])
  expect(getProviderEffortWireValue(model, 'deep', 'ollama')).toBe('Deep')
  expect(resolveProviderEffortLevel(model, 'unknown-level', 'ollama')).toBeUndefined()
  expect(resolveProviderEffortLevel(model, 'max', 'ollama')).toBe('max')
  expect(request({ type: 'adaptive' }, 'deep').think).toBe('Deep')
  expect(parseEffortValue('Deep')).toBe('deep')
  expect(parseOllamaThinkingCapabilities({ capabilities: ['thinking'] })).toBeUndefined()
})


test('custom native defaults remain selectable without assigning them an invented rank', () => {
  const value = { thinking: { values: ['Brief', 'Deep'], default: 'Deep' } }
  cacheOllamaModelMetadata(model, value, [], baseUrl)
  cacheProviderModelsForProvider('ollama', [{ id: model, displayName: model, description: 'fixture', reasoning: parseOllamaThinkingCapabilities(value) }])
  expect(getSupportedEffortLevelsForModel(model, 'ollama')).toEqual(['brief', 'deep'])
  expect(getDefaultEffortForModel(model, 'ollama')).toBe('deep')
  expect(resolveProviderEffortLevel(model, 'max', 'ollama')).toBeUndefined()
  expect(request({ type: 'adaptive' }, 'deep').think).toBe('Deep')
})
