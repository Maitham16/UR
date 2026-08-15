import { describe, expect, test } from 'bun:test'
import {
  dedupeModels,
  describeCacheAge,
  MODEL_CACHE_TTL_MS,
  orderModels,
  parseDiscoveredModels,
  parseModelReasoningCapabilities,
  pricingTierFromId,
  pricingTierFromOpenRouter,
  RequestCoalescer,
  toDiscoveredModel,
  type DiscoveredModel,
} from '../src/services/providers/modelCatalog.js'

// Shape taken from https://openrouter.ai/docs/api-reference/list-available-models
const OPENROUTER_BODY = {
  data: [
    {
      id: 'z-ai/glm-4.6',
      name: 'Z.AI: GLM 4.6',
      context_length: 200000,
      pricing: { prompt: '0.0000004', completion: '0.0000016' },
    },
    {
      id: 'deepseek/deepseek-r1:free',
      name: 'DeepSeek: R1 (free)',
      context_length: 163840,
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'openai/gpt-4o-mini',
      name: 'OpenAI: GPT-4o-mini',
      context_length: 128000,
      pricing: { prompt: '0.00000015', completion: '0.0000006' },
    },
    {
      id: 'legacy/retired-model',
      name: 'Retired',
      description: 'Deprecated: use the successor instead',
      pricing: { prompt: '0.000001', completion: '0.000002' },
    },
  ],
}

describe('OpenRouter pricing tiers', () => {
  test('zero prompt and completion price is free', () => {
    expect(pricingTierFromOpenRouter({ prompt: '0', completion: '0' })).toBe('free')
    expect(pricingTierFromOpenRouter({ prompt: 0, completion: 0 })).toBe('free')
  })

  test('any non-zero dimension is paid', () => {
    expect(pricingTierFromOpenRouter({ prompt: '0', completion: '0.0000016' })).toBe('paid')
    expect(pricingTierFromOpenRouter({ prompt: '0.0000004', completion: '0' })).toBe('paid')
    expect(pricingTierFromOpenRouter({ prompt: '0', completion: '0', request: '0.01' })).toBe('paid')
    expect(pricingTierFromOpenRouter({ prompt: '0', completion: '0', image: '0.001' })).toBe('paid')
  })

  test('absent or unparseable pricing is unknown, never assumed free', () => {
    expect(pricingTierFromOpenRouter(undefined)).toBe('unknown')
    expect(pricingTierFromOpenRouter({})).toBe('unknown')
    expect(pricingTierFromOpenRouter({ prompt: 'n/a', completion: '0' })).toBe('unknown')
    expect(pricingTierFromOpenRouter({ prompt: '0' })).toBe('unknown')
  })

  test('the :free id suffix is the fallback signal', () => {
    expect(pricingTierFromId('deepseek/deepseek-r1:free')).toBe('free')
    expect(pricingTierFromId('openai/gpt-4o-mini')).toBe('unknown')
  })

  test('pricing wins over the id suffix', () => {
    // A model named ":free" that now costs money must not stay labelled free.
    const model = toDiscoveredModel(
      { id: 'x/y:free', pricing: { prompt: '0.001', completion: '0.002' } },
      'OpenRouter',
    )
    expect(model?.pricing).toBe('paid')
  })
})

describe('model entry construction', () => {
  test('the full id is always shown, with the human name alongside', () => {
    const model = toDiscoveredModel(OPENROUTER_BODY.data[1], 'OpenRouter')
    expect(model?.id).toBe('deepseek/deepseek-r1:free')
    expect(model?.displayName).toContain('deepseek/deepseek-r1:free')
    expect(model?.displayName).toContain('DeepSeek: R1 (free)')
  })

  test('free tier and context length are surfaced in the description', () => {
    const model = toDiscoveredModel(OPENROUTER_BODY.data[1], 'OpenRouter')
    expect(model?.description).toContain('free')
    expect(model?.description).toContain('164K ctx')
  })

  test('a provider returning only ids still yields a usable entry', () => {
    const model = toDiscoveredModel('llama3.1:8b', 'Ollama')
    expect(model).toMatchObject({ id: 'llama3.1:8b', displayName: 'llama3.1:8b' })
  })

  test('deprecation is detected and labelled', () => {
    const model = toDiscoveredModel(OPENROUTER_BODY.data[3], 'OpenRouter')
    expect(model?.deprecated).toBe(true)
    expect(model?.description).toContain('deprecated')
  })

  test('expired OpenRouter entries and tool capability metadata are preserved', () => {
    const model = toDiscoveredModel({
      id: 'expired/tool-model',
      pricing: { prompt: '0', completion: '0', request: '0' },
      supported_parameters: ['tools', 'temperature'],
      expiration_date: 1,
    }, 'OpenRouter')
    expect(model).toMatchObject({
      pricing: 'free',
      deprecated: true,
      expirationDate: 1,
      supportedParameters: ['tools', 'temperature'],
    })
  })

  test('OpenRouter reasoning effort metadata is normalized and preserved', () => {
    const model = toDiscoveredModel({
      id: 'qwen/qwen3.8-max',
      supported_parameters: ['reasoning', 'reasoning_effort', 'tools'],
      reasoning: {
        mandatory: true,
        default_enabled: true,
        supported_efforts: ['XHIGH', 'high', 'medium', 'low', 'minimal', 'XHIGH'],
        default_effort: 'XHIGH',
      },
    }, 'OpenRouter')

    expect(model?.reasoning).toEqual({
      mandatory: true,
      defaultEnabled: true,
      supportedEfforts: ['xhigh', 'high', 'medium', 'low', 'minimal'],
      defaultEffort: 'xhigh',
    })
  })

  test('null supported efforts preserves the gateway accepts-all contract', () => {
    expect(parseModelReasoningCapabilities({ supported_efforts: null })).toEqual({
      supportedEfforts: null,
    })
  })

  test('unusable entries are dropped rather than rendered blank', () => {
    expect(toDiscoveredModel(null, 'X')).toBeNull()
    expect(toDiscoveredModel({}, 'X')).toBeNull()
    expect(toDiscoveredModel('   ', 'X')).toBeNull()
    expect(toDiscoveredModel(42, 'X')).toBeNull()
  })
})

describe('ordering and de-duplication', () => {
  test('free first, deprecated last, alphabetical within a group', () => {
    const ordered = parseDiscoveredModels(OPENROUTER_BODY, 'OpenRouter')
    expect(ordered.map(m => m.id)).toEqual([
      'deepseek/deepseek-r1:free',
      'openai/gpt-4o-mini',
      'z-ai/glm-4.6',
      'legacy/retired-model',
    ])
  })

  test('duplicate ids collapse to the first occurrence', () => {
    const models: DiscoveredModel[] = [
      { id: 'a', displayName: 'a', description: 'first', pricing: 'free' },
      { id: 'a', displayName: 'a', description: 'second', pricing: 'paid' },
      { id: 'b', displayName: 'b', description: '', pricing: 'paid' },
    ]
    const deduped = dedupeModels(models)
    expect(deduped).toHaveLength(2)
    expect(deduped[0]!.description).toBe('first')
  })

  test('ordering is stable and does not mutate the input', () => {
    const input: DiscoveredModel[] = [
      { id: 'b', displayName: 'b', description: '', pricing: 'paid' },
      { id: 'a', displayName: 'a', description: '', pricing: 'paid' },
    ]
    const copy = [...input]
    orderModels(input)
    expect(input).toEqual(copy)
  })

  test('an empty or malformed body yields an empty list, not a throw', () => {
    expect(parseDiscoveredModels(undefined, 'X')).toEqual([])
    expect(parseDiscoveredModels({}, 'X')).toEqual([])
    expect(parseDiscoveredModels({ data: 'nope' }, 'X')).toEqual([])
  })

  test('a bare array body is accepted', () => {
    expect(parseDiscoveredModels(['m1', 'm2'], 'X').map(m => m.id)).toEqual(['m1', 'm2'])
  })
})

describe('cache freshness labelling', () => {
  test('a fresh entry is not labelled as stale', () => {
    expect(describeCacheAge(0)).toBeNull()
    expect(describeCacheAge(MODEL_CACHE_TTL_MS - 1)).toBeNull()
  })

  test('an entry past the TTL reports its age', () => {
    expect(describeCacheAge(MODEL_CACHE_TTL_MS + 60_000)).toBe('cached 6m ago')
    expect(describeCacheAge(3 * 60 * 60 * 1000)).toBe('cached 3h ago')
  })

  test('a nonsense age is not rendered', () => {
    expect(describeCacheAge(-1)).toBeNull()
    expect(describeCacheAge(Number.NaN)).toBeNull()
  })
})

describe('duplicate request suppression', () => {
  test('concurrent identical requests share one call', async () => {
    const coalescer = new RequestCoalescer<number>()
    let calls = 0
    const factory = async () => {
      calls++
      await new Promise(resolve => setTimeout(resolve, 10))
      return calls
    }
    const [a, b, c] = await Promise.all([
      coalescer.run('k', factory),
      coalescer.run('k', factory),
      coalescer.run('k', factory),
    ])
    expect(calls).toBe(1)
    expect([a, b, c]).toEqual([1, 1, 1])
    expect(coalescer.size).toBe(0)
  })

  test('different keys are not collapsed together', async () => {
    const coalescer = new RequestCoalescer<string>()
    const [a, b] = await Promise.all([
      coalescer.run('openrouter', async () => 'openrouter'),
      coalescer.run('ollama', async () => 'ollama'),
    ])
    expect(a).toBe('openrouter')
    expect(b).toBe('ollama')
  })

  test('a rejection clears the slot so a retry can proceed', async () => {
    const coalescer = new RequestCoalescer<string>()
    let attempts = 0
    const failing = async () => {
      attempts++
      throw new Error('network down')
    }
    await expect(coalescer.run('k', failing)).rejects.toThrow('network down')
    expect(coalescer.size).toBe(0)
    await expect(coalescer.run('k', failing)).rejects.toThrow('network down')
    expect(attempts).toBe(2)
  })

  test('a later request after settlement issues a fresh call', async () => {
    const coalescer = new RequestCoalescer<number>()
    let calls = 0
    const factory = async () => ++calls
    expect(await coalescer.run('k', factory)).toBe(1)
    expect(await coalescer.run('k', factory)).toBe(2)
  })

  test('one cancelled subscriber does not abort another subscriber', async () => {
    const coalescer = new RequestCoalescer<number>()
    let complete!: (value: number) => void
    const shared = new Promise<number>(resolve => { complete = resolve })
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = coalescer.run('k', async () => shared, firstController.signal)
    const second = coalescer.run('k', async () => shared, secondController.signal)

    firstController.abort(new Error('first cancelled'))
    await expect(first).rejects.toThrow('first cancelled')
    complete(7)
    await expect(second).resolves.toBe(7)
  })
})
