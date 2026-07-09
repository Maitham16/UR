import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resetStateForTests,
  setCwdState,
  setOriginalCwd,
} from '../src/bootstrap/state.js'
import { createOpenAICompatibleClient } from '../src/services/api/openaiCompatible.js'
import { createStandardAPIClient } from '../src/services/api/standardAPI.js'
import {
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  ProviderHTTPError,
  getProviderRequestTimeoutMs,
  isRetryableProviderError,
  normalizeOpenAICompatibleBaseUrl,
} from '../src/services/api/providerHttp.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'

const openAITextResponse = {
  id: 'chatcmpl_text',
  model: 'gpt-test',
  choices: [
    {
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 1 },
}

function userMessages() {
  return [{ role: 'user', content: 'hello' }]
}

function textResponse(status = 200): Response {
  return new Response(JSON.stringify(openAITextResponse), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('provider timeout, retry, and base URL reliability', () => {
  const originalFetch = globalThis.fetch
  const originalTimeout = process.env.API_TIMEOUT_MS
  const originalUrTimeout = process.env.UR_API_TIMEOUT_MS
  const originalRetryDelay = process.env.UR_PROVIDER_RETRY_BASE_MS

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreEnv('API_TIMEOUT_MS', originalTimeout)
    restoreEnv('UR_API_TIMEOUT_MS', originalUrTimeout)
    restoreEnv('UR_PROVIDER_RETRY_BASE_MS', originalRetryDelay)
    if ((axios.post as any).mockRestore) (axios.post as any).mockRestore()
    resetSettingsCache()
  })

  test('provider calls default to a finite timeout', async () => {
    delete process.env.API_TIMEOUT_MS
    delete process.env.UR_API_TIMEOUT_MS
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAITextResponse,
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 0,
    })

    await client.beta.messages.create({
      model: 'gpt-5.5',
      messages: userMessages(),
      max_tokens: 16,
    })

    const [, , config] = post.mock.calls[0]
    expect(config.timeout).toBe(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS)
    expect(getProviderRequestTimeoutMs()).toBe(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS)
  })

  test('provider timeout can be overridden per request', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAITextResponse,
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 0,
    })

    await client.beta.messages.create(
      {
        model: 'gpt-5.5',
        messages: userMessages(),
        max_tokens: 16,
      },
      { timeoutMs: 45_000 },
    )

    const [, , config] = post.mock.calls[0]
    expect(config.timeout).toBe(45_000)
  })

  test('provider timeout can be overridden by environment variables', () => {
    process.env.API_TIMEOUT_MS = '33000'
    delete process.env.UR_API_TIMEOUT_MS
    expect(getProviderRequestTimeoutMs()).toBe(33_000)

    delete process.env.API_TIMEOUT_MS
    process.env.UR_API_TIMEOUT_MS = '44000'
    expect(getProviderRequestTimeoutMs()).toBe(44_000)
  })

  test('provider timeout can be overridden by settings', () => {
    delete process.env.API_TIMEOUT_MS
    delete process.env.UR_API_TIMEOUT_MS
    const dir = mkdtempSync(join(tmpdir(), 'ur-provider-timeout-settings-'))
    try {
      resetStateForTests()
      setOriginalCwd(dir)
      setCwdState(dir)
      mkdirSync(join(dir, '.ur'), { recursive: true })
      writeFileSync(
        join(dir, '.ur', 'settings.json'),
        JSON.stringify({ provider: { timeoutMs: 55_000 } }),
      )
      resetSettingsCache()

      expect(getProviderRequestTimeoutMs()).toBe(55_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      resetStateForTests()
      resetSettingsCache()
    }
  })

  test('OpenAI-compatible base URLs normalize root, v1, and full endpoint forms', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:1234')).toBe(
      'http://localhost:1234/v1/chat/completions',
    )
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:1234/')).toBe(
      'http://localhost:1234/v1/chat/completions',
    )
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:1234/v1')).toBe(
      'http://localhost:1234/v1/chat/completions',
    )
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:1234/v1/')).toBe(
      'http://localhost:1234/v1/chat/completions',
    )
    expect(
      normalizeOpenAICompatibleBaseUrl(
        'http://localhost:1234/v1/chat/completions',
      ),
    ).toBe('http://localhost:1234/v1/chat/completions')
  })

  test('OpenAI-compatible fetch retries retryable provider errors', async () => {
    process.env.UR_PROVIDER_RETRY_BASE_MS = '0'
    const urls: string[] = []
    let calls = 0
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(url))
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      calls++
      if (calls === 1) {
        return new Response('temporarily unavailable', { status: 503 })
      }
      return textResponse()
    }) as unknown as typeof fetch

    const client = await createOpenAICompatibleClient({
      baseUrl: 'http://localhost:1234',
      maxRetries: 1,
    })
    const res = await client.beta.messages.create({
      model: 'local-model',
      messages: userMessages(),
      max_tokens: 16,
    })

    expect(res.stop_reason).toBe('end_turn')
    expect(calls).toBe(2)
    expect(urls).toEqual([
      'http://localhost:1234/v1/chat/completions',
      'http://localhost:1234/v1/chat/completions',
    ])
  })

  test('OpenAI-compatible fetch does not retry non-retryable auth errors', async () => {
    process.env.UR_PROVIDER_RETRY_BASE_MS = '0'
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response('invalid api key', { status: 401 })
    }) as unknown as typeof fetch

    const client = await createOpenAICompatibleClient({
      baseUrl: 'http://localhost:1234/v1',
      maxRetries: 3,
    })

    await expect(
      client.beta.messages.create({
        model: 'local-model',
        messages: userMessages(),
        max_tokens: 16,
      }),
    ).rejects.toThrow('401')
    expect(calls).toBe(1)
  })

  test('retry classifier covers transient network, retryable HTTP, and non-retryable provider errors', () => {
    expect(isRetryableProviderError({ code: 'ECONNRESET' })).toBe(true)
    for (const status of [408, 429, 500, 502, 503, 504, 529]) {
      expect(isRetryableProviderError(new ProviderHTTPError('retryable', { status }))).toBe(true)
    }

    expect(
      isRetryableProviderError(
        new ProviderHTTPError('bad request / malformed request', { status: 400 }),
      ),
    ).toBe(false)
    expect(
      isRetryableProviderError(
        new ProviderHTTPError('invalid api key', { status: 401 }),
      ),
    ).toBe(false)
    expect(
      isRetryableProviderError(
        new ProviderHTTPError('invalid model', { status: 404 }),
      ),
    ).toBe(false)
    expect(
      isRetryableProviderError(
        new ProviderHTTPError('unsupported tool use', { status: 422 }),
      ),
    ).toBe(false)
  })

  test('standard OpenAI root base URL is completed with /v1/chat/completions', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: openAITextResponse,
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.example.test',
      maxRetries: 0,
    })

    await client.beta.messages.create({
      model: 'gpt-5.5',
      messages: userMessages(),
      max_tokens: 16,
    })

    const [url] = post.mock.calls[0]
    expect(url).toBe('https://api.example.test/v1/chat/completions')
  })
})
