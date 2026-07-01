import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import {
  createURHQSubscriptionClient,
  getSubscriptionCliStdinMode,
} from '../src/services/api/urhqSubscription.js'
import { createStandardAPIClient } from '../src/services/api/standardAPI.js'
import { createOpenAICompatibleClient } from '../src/services/api/openaiCompatible.js'
import { resolveActiveProviderModel } from '../src/services/api/providerClient.js'
import {
  clearProviderModelCacheForTests,
  getProviderFamily,
  getRuntimeProviderId,
  PROVIDER_IDS,
} from '../src/services/providers/providerRegistry.js'

function userMessages() {
  return [{ role: 'user', content: 'hello' }]
}

function recordingRunner(result: { code?: number; stdout?: string; stderr?: string }) {
  const calls: Array<{ command: string; args: string[] }> = []
  const runner = async (command: string, args: string[]) => {
    calls.push({ command, args })
    return { code: result.code ?? 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }
  return { runner, calls }
}

describe('subscription CLI dispatch is real (not faked)', () => {
  test('codex-cli spawns the CLI with mapped model and returns its stdout', async () => {
    const { runner, calls } = recordingRunner({ stdout: 'the real answer' })
    const client = createURHQSubscriptionClient('codex-cli', {
      commandPath: '/usr/bin/codex',
      maxRetries: 1,
      model: 'codex/gpt-5.5',
      runner,
    })
    const res = await client.beta.messages.create({
      model: 'codex/gpt-5.5',
      messages: userMessages(),
      max_tokens: 16,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('/usr/bin/codex')
    expect(calls[0].args).toContain('--model')
    expect(calls[0].args).toContain('gpt-5.5') // provider prefix stripped
    expect(calls[0].args.join(' ')).toContain('hello') // prompt forwarded
    expect(res.content[0].text).toBe('the real answer')
    expect(res.content[0].text).not.toBe('Subscription CLI response') // regression guard
  })

  test('default runner does not pipe empty stdin when prompt is already an argument', () => {
    expect(getSubscriptionCliStdinMode(undefined)).toBe('ignore')
    expect(getSubscriptionCliStdinMode('')).toBe('pipe')
  })

  test('codex-cli is dispatched with a closed empty stdin, not /dev/null (stdin-block fix)', async () => {
    let receivedInput: string | undefined = 'unset'
    const runner = async (_c: string, _a: string[], opts: { input?: string }) => {
      receivedInput = opts?.input
      return { code: 0, stdout: 'ok', stderr: '' }
    }
    const client = createURHQSubscriptionClient('codex-cli', {
      commandPath: 'codex',
      maxRetries: 1,
      runner,
    })
    await client.beta.messages.create({
      model: 'codex/gpt-5.5',
      messages: userMessages(),
      max_tokens: 16,
    })
    // Empty string -> stdin pipe that is written and closed (EOF); undefined -> ignore.
    expect(receivedInput).toBe('')
    expect(getSubscriptionCliStdinMode(receivedInput)).toBe('pipe')
  })

  test('arg-mode CLIs (claude/gemini) leave stdin ignored', async () => {
    let receivedInput: string | undefined = 'unset'
    const runner = async (_c: string, _a: string[], opts: { input?: string }) => {
      receivedInput = opts?.input
      return { code: 0, stdout: 'ok', stderr: '' }
    }
    const client = createURHQSubscriptionClient('gemini-cli', {
      commandPath: 'gemini',
      maxRetries: 1,
      runner,
    })
    await client.beta.messages.create({
      model: 'gemini-cli/gemini-2.5-pro',
      messages: userMessages(),
      max_tokens: 16,
    })
    expect(receivedInput).toBeUndefined()
    expect(getSubscriptionCliStdinMode(receivedInput)).toBe('ignore')
  })

  test('claude-code-cli parses JSON stdout (.result)', async () => {
    const { runner, calls } = recordingRunner({ stdout: JSON.stringify({ result: 'claude says hi' }) })
    const client = createURHQSubscriptionClient('claude-code-cli', {
      commandPath: 'claude',
      maxRetries: 1,
      runner,
    })
    const res = await client.beta.messages.create({
      model: 'claude-code/sonnet',
      messages: userMessages(),
      max_tokens: 16,
    })
    expect(calls[0].args).toContain('sonnet')
    expect(calls[0].args).not.toContain('sonnet-5')
    expect(res.content[0].text).toBe('claude says hi')
  })

  test('gemini-cli returns raw stdout when not JSON', async () => {
    const { runner, calls } = recordingRunner({ stdout: 'gemini plain text' })
    const client = createURHQSubscriptionClient('gemini-cli', {
      commandPath: 'gemini',
      maxRetries: 1,
      runner,
    })
    const res = await client.beta.messages.create({
      model: 'gemini-cli/gemini-2.5-pro',
      messages: userMessages(),
      max_tokens: 16,
    })
    expect(calls[0].args).toContain('gemini-2.5-pro')
    expect(res.content[0].text).toBe('gemini plain text')
  })

  test('cli JSON error is reported as provider-scoped failure, not assistant text', async () => {
    const { runner } = recordingRunner({
      code: 1,
      stdout: JSON.stringify({
        type: 'result',
        is_error: true,
        api_error_status: 404,
        result: "There's an issue with the selected model (sonnet-5).",
      }),
    })
    const client = createURHQSubscriptionClient('claude-code-cli', {
      commandPath: 'claude',
      maxRetries: 1,
      runner,
    })
    let message = ''
    try {
      await client.beta.messages.create({
        model: 'claude-code/sonnet',
        messages: userMessages(),
        max_tokens: 16,
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('claude-code-cli exited 1 (status 404) with model "sonnet"')
    expect(message).toContain('UR did not fall back to another provider')
  })

  test('cli success exit with is_error JSON is still treated as failure', async () => {
    const { runner } = recordingRunner({
      code: 0,
      stdout: JSON.stringify({ is_error: true, result: 'model unavailable' }),
    })
    const client = createURHQSubscriptionClient('claude-code-cli', {
      commandPath: 'claude',
      maxRetries: 1,
      runner,
    })
    await expect(
      client.beta.messages.create({
        model: 'claude-code/sonnet',
        messages: userMessages(),
        max_tokens: 16,
      }),
    ).rejects.toThrow('reported an error with model "sonnet"')
  })

  test('gemini account-tier errors are summarized without dumping the stack', async () => {
    const { runner } = recordingRunner({
      code: 55,
      stderr: `Error authenticating: IneligibleTierError: This client is no longer supported
    at throwIneligibleOrProjectIdError (file:///bundle.js:1:1) {
      reasonCode: 'UNSUPPORTED_CLIENT',
      reasonMessage: 'This client is no longer supported for Gemini Code Assist for individuals.'
    }`,
    })
    const client = createURHQSubscriptionClient('gemini-cli', {
      commandPath: 'gemini',
      maxRetries: 1,
      runner,
    })
    await expect(
      client.beta.messages.create({
        model: 'gemini-cli/gemini-2.5-pro',
        messages: userMessages(),
        max_tokens: 16,
      }),
    ).rejects.toThrow('This client is no longer supported for Gemini Code Assist for individuals.')
  })

  test('non-zero exit fails clearly, does not fabricate a response', async () => {
    const { runner } = recordingRunner({ code: 1, stderr: 'not logged in' })
    const client = createURHQSubscriptionClient('codex-cli', {
      commandPath: 'codex',
      maxRetries: 1,
      runner,
    })
    await expect(
      client.beta.messages.create({
        model: 'codex/gpt-5.5',
        messages: userMessages(),
        max_tokens: 16,
      }),
    ).rejects.toThrow('not logged in')
  })

  test('empty stdout fails clearly', async () => {
    const { runner } = recordingRunner({ stdout: '   ' })
    const client = createURHQSubscriptionClient('codex-cli', {
      commandPath: 'codex',
      maxRetries: 1,
      runner,
    })
    await expect(
      client.beta.messages.create({
        model: 'codex/gpt-5.5',
        messages: userMessages(),
        max_tokens: 16,
      }),
    ).rejects.toThrow('no output')
  })
})

describe('standard API wire formats', () => {
  afterEach(() => {
    if ((axios.post as any).mockRestore) (axios.post as any).mockRestore()
  })

  test('anthropic-api uses x-api-key + anthropic-version, not Bearer', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        id: 'msg_1',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'hi from claude' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 4 },
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'anthropic-api',
      apiKey: 'sk-ant-test',
      maxRetries: 1,
    })
    const res = await client.beta.messages.create({
      model: 'claude-sonnet-5',
      system: 'be terse',
      messages: userMessages(),
      max_tokens: 32,
    })
    const [url, body, config] = post.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(config.headers['x-api-key']).toBe('sk-ant-test')
    expect(config.headers['anthropic-version']).toBeDefined()
    expect(config.headers.Authorization).toBeUndefined()
    expect(body.system).toBe('be terse')
    expect(body.messages).toEqual(userMessages())
    expect(res.content[0].text).toBe('hi from claude')
  })

  test('gemini-api posts generateContent with contents/parts', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        candidates: [{ content: { parts: [{ text: 'hi from gemini' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'gemini-api',
      apiKey: 'gm-key',
      maxRetries: 1,
    })
    const res = await client.beta.messages.create({
      model: 'gemini-3.5-flash',
      messages: userMessages(),
      max_tokens: 32,
    })
    const [url, body, config] = post.mock.calls[0]
    expect(url).toContain('/models/gemini-3.5-flash:generateContent')
    expect(config.headers['x-goog-api-key']).toBe('gm-key')
    expect(body.contents[0].parts[0].text).toBe('hello')
    expect(res.content[0].text).toBe('hi from gemini')
  })

  test('openai-api posts chat/completions with Bearer', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: {
        id: 'cmpl_1',
        model: 'gpt-5.5',
        choices: [{ message: { content: 'hi from openai' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      },
      headers: {},
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 1,
    })
    const res = await client.beta.messages.create({
      model: 'gpt-5.5',
      messages: userMessages(),
      max_tokens: 32,
    })
    const [url, , config] = post.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(config.headers.Authorization).toBe('Bearer sk-openai')
    expect(res.content[0].text).toBe('hi from openai')
  })
})

describe('openai-compatible adapter', () => {
  test('posts to <base>/chat/completions and parses the choice', async () => {
    const original = globalThis.fetch
    const seen: Array<{ url: string; body: any }> = []
    globalThis.fetch = (async (url: string, init: any) => {
      seen.push({ url, body: JSON.parse(init.body) })
      return new Response(
        JSON.stringify({
          id: 'x',
          model: 'local-model',
          choices: [{ message: { content: 'hi from lmstudio' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
    try {
      const client = await createOpenAICompatibleClient({
        baseUrl: 'http://localhost:1234/v1',
        maxRetries: 1,
      })
      const res = await client.beta.messages.create({
        model: 'local-model',
        messages: userMessages(),
        max_tokens: 16,
      })
      expect(seen[0].url).toBe('http://localhost:1234/v1/chat/completions')
      expect(seen[0].body.model).toBe('local-model')
      expect(res.content[0].text).toBe('hi from lmstudio')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('real provider identity', () => {
  test('every provider maps to a correct family', () => {
    const expected: Record<string, string> = {
      'codex-cli': 'openai',
      'openai-api': 'openai',
      'claude-code-cli': 'anthropic',
      'anthropic-api': 'anthropic',
      'gemini-cli': 'google',
      'gemini-api': 'google',
      'antigravity-cli': 'google',
      openrouter: 'openai-compatible',
      'openai-compatible': 'openai-compatible',
      lmstudio: 'openai-compatible',
      'llama.cpp': 'openai-compatible',
      vllm: 'openai-compatible',
      ollama: 'ollama',
    }
    for (const id of PROVIDER_IDS) {
      expect(getProviderFamily(id)).toBe(expected[id])
    }
  })

  test('runtime provider id reflects the selected provider, never collapsed', () => {
    expect(getRuntimeProviderId({ provider: { active: 'openai-api' } } as any)).toBe('openai-api')
    expect(getRuntimeProviderId({ provider: { active: 'gemini-cli' } } as any)).toBe('gemini-cli')
    expect(getRuntimeProviderId({} as any)).toBe('ollama') // default only when unset
  })
})

describe('config save/load preserves live-provider pairs across a cold process', () => {
  afterEach(() => clearProviderModelCacheForTests())

  test('saved lmstudio/ollama/vllm models resolve with an empty cache', () => {
    clearProviderModelCacheForTests()
    for (const [provider, model, backend] of [
      ['lmstudio', 'my-local-model', 'openai-compatible:lmstudio'],
      ['ollama', 'llama3:latest', 'ollama'],
      ['vllm', 'served-model', 'openai-compatible:vllm'],
    ] as const) {
      const runtime = resolveActiveProviderModel({
        settings: { provider: { active: provider, model } } as any,
      })
      expect(runtime.providerId).toBe(provider)
      expect(runtime.model).toBe(model)
      expect(runtime.runtimeBackend).toBe(backend)
    }
  })

  test('static provider still rejects an invalid saved model', () => {
    clearProviderModelCacheForTests()
    expect(() =>
      resolveActiveProviderModel({
        settings: { provider: { active: 'openai-api', model: 'claude-sonnet-5' } } as any,
      }),
    ).toThrow('runtime dispatch cannot use')
  })
})
