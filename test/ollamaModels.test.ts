import { expect, test } from 'bun:test'
import { getContextWindowForModel } from '../src/utils/context.js'
import {
  cacheOllamaModelMetadata,
  cacheOllamaModelsFromTags,
  clearOllamaModelMetadataCacheForTests,
  getOllamaBaseUrl,
  getOllamaContextLengthForModel,
  mergeModelOptions,
  parseOllamaModelNames,
} from '../src/utils/model/ollamaModels.js'
import type { ModelOption } from '../src/utils/model/modelOptions.js'

test('parseOllamaModelNames returns sorted unique model names', () => {
  expect(
    parseOllamaModelNames({
      models: [
        { name: 'qwen2.5-coder:latest' },
        { model: 'llama3.2:latest' },
        { name: 'qwen2.5-coder:latest' },
        { name: '  mistral:7b  ' },
        { name: '' },
        {},
      ],
    }),
  ).toEqual(['llama3.2:latest', 'mistral:7b', 'qwen2.5-coder:latest'])
})

test('getOllamaBaseUrl always returns the local endpoint and ignores env overrides', () => {
  const originalBase = process.env.OLLAMA_BASE_URL
  const originalHost = process.env.OLLAMA_HOST
  try {
    process.env.OLLAMA_HOST = '127.0.0.1:9999/'
    process.env.OLLAMA_BASE_URL = 'https://ollama.example.test/'
    expect(getOllamaBaseUrl()).toBe('http://localhost:11434')
  } finally {
    if (originalBase === undefined) {
      delete process.env.OLLAMA_BASE_URL
    } else {
      process.env.OLLAMA_BASE_URL = originalBase
    }
    if (originalHost === undefined) {
      delete process.env.OLLAMA_HOST
    } else {
      process.env.OLLAMA_HOST = originalHost
    }
  }
})

test('mergeModelOptions appends only missing model values', () => {
  const base: ModelOption[] = [
    { value: null, label: 'Default', description: 'Default model' },
    { value: 'llama3.2:latest', label: 'llama3.2:latest', description: 'Current model' },
  ]
  const extra: ModelOption[] = [
    {
      value: 'llama3.2:latest',
      label: 'llama3.2:latest',
      description: 'Installed Ollama model',
    },
    {
      value: 'qwen2.5-coder:latest',
      label: 'qwen2.5-coder:latest',
      description: 'Installed Ollama model',
    },
  ]
  expect(mergeModelOptions(base, extra)).toEqual([
    base[0],
    base[1],
    extra[1],
  ])
})

test('cacheOllamaModelsFromTags stores advertised context lengths', () => {
  withCleanOllamaContext(() => {
    cacheOllamaModelsFromTags({
      models: [
        {
          name: 'minimax-m3:cloud',
          model: 'minimax-m3:cloud',
          remote_model: 'minimax-m3',
          details: { context_length: 524_288 },
        },
      ],
    })

    expect(getOllamaContextLengthForModel('minimax-m3:cloud')).toBe(524_288)
    expect(getOllamaContextLengthForModel('minimax-m3')).toBe(524_288)
    expect(getContextWindowForModel('minimax-m3:cloud')).toBe(524_288)
  })
})

test('cacheOllamaModelMetadata reads context length from api/show model_info', () => {
  withCleanOllamaContext(() => {
    cacheOllamaModelMetadata('minimax-m3:cloud', {
      capabilities: ['completion', 'tools', 'thinking', 'vision'],
      model_info: {
        'minimax-m3.context_length': 524_288,
      },
    })

    expect(getOllamaContextLengthForModel('minimax-m3:cloud')).toBe(524_288)
    expect(getContextWindowForModel('minimax-m3:cloud')).toBe(524_288)
  })
})

test('OLLAMA_CONTEXT_TOKENS overrides advertised Ollama context length', () => {
  withCleanOllamaContext(() => {
    process.env.OLLAMA_CONTEXT_TOKENS = '123456'
    cacheOllamaModelMetadata('minimax-m3:cloud', {
      model_info: {
        'minimax-m3.context_length': 524_288,
      },
    })

    expect(getContextWindowForModel('minimax-m3:cloud')).toBe(123_456)
  })
})

function withCleanOllamaContext(run: () => void): void {
  const originalContextTokens = process.env.OLLAMA_CONTEXT_TOKENS
  clearOllamaModelMetadataCacheForTests()
  try {
    delete process.env.OLLAMA_CONTEXT_TOKENS
    run()
  } finally {
    clearOllamaModelMetadataCacheForTests()
    if (originalContextTokens === undefined) {
      delete process.env.OLLAMA_CONTEXT_TOKENS
    } else {
      process.env.OLLAMA_CONTEXT_TOKENS = originalContextTokens
    }
  }
}
