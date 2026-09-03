import { afterEach, describe, expect, test } from 'bun:test'
import type { Message } from '../src/types/message.js'
import { handlePromptSubmit } from '../src/utils/handlePromptSubmit.js'
import { QueryGuard } from '../src/utils/QueryGuard.js'

const originalFetch = globalThis.fetch
const originalNvidiaKey = process.env.NVIDIA_API_KEY

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY
  else process.env.NVIDIA_API_KEY = originalNvidiaKey
})

describe('NVIDIA Special prompt dispatch', () => {
  test('bypasses the ongoing provider and appends the NVIDIA result', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test'
    const requests: string[] = []
    globalThis.fetch = (async (input, init) => {
      requests.push(String(input))
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'google/diffusiongemma-26b-a4b-it',
        messages: [{ role: 'user', content: 'Write about an 8mm projector.' }],
      })
      return Response.json({
        choices: [{ message: { content: 'The projector casts a warm flicker.' } }],
      })
    }) as typeof fetch

    let messages: Message[] = []
    let queriedOngoingProvider = false
    const guard = new QueryGuard()

    await handlePromptSubmit({
      input: 'Write about an 8mm projector.',
      mode: 'prompt',
      pastedContents: {},
      helpers: {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {},
      },
      queryGuard: guard,
      commands: [],
      onInputChange: () => {},
      setPastedContents: () => {},
      setToolJSX: () => {},
      getToolUseContext: () =>
        ({
          getAppState: () => ({
            nvidiaTaskModel: 'google/diffusiongemma-26b-a4b-it',
          }),
        }) as never,
      messages,
      mainLoopModel: 'claude-opus-5',
      ideSelection: undefined,
      querySource: 'repl',
      setUserInputOnProcessing: () => {},
      setAbortController: () => {},
      onQuery: async () => {
        queriedOngoingProvider = true
      },
      setAppState: updater => updater({} as never),
      setMessages: updater => {
        messages = updater(messages)
      },
    })

    expect(queriedOngoingProvider).toBe(false)
    expect(requests).toEqual([
      'https://integrate.api.nvidia.com/v1/chat/completions',
    ])
    expect(guard.status).toBe('idle')
    expect(messages).toHaveLength(2)
    expect(JSON.stringify(messages[1])).toContain(
      'The projector casts a warm flicker.',
    )
  })

  test('reports missing contract inputs without querying the chat provider', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test'
    let messages: Message[] = []
    let queriedOngoingProvider = false

    await handlePromptSubmit({
      input: 'Make this look like 8mm film.',
      mode: 'prompt',
      pastedContents: {},
      helpers: {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {},
      },
      queryGuard: new QueryGuard(),
      commands: [],
      onInputChange: () => {},
      setPastedContents: () => {},
      setToolJSX: () => {},
      getToolUseContext: () =>
        ({
          getAppState: () => ({
            nvidiaTaskModel: 'nvidia/cosmos-transfer1-7b',
          }),
        }) as never,
      messages,
      mainLoopModel: 'claude-opus-5',
      ideSelection: undefined,
      querySource: 'repl',
      setUserInputOnProcessing: () => {},
      setAbortController: () => {},
      onQuery: async () => {
        queriedOngoingProvider = true
      },
      setAppState: updater => updater({} as never),
      setMessages: updater => {
        messages = updater(messages)
      },
    })

    expect(queriedOngoingProvider).toBe(false)
    expect(JSON.stringify(messages[1])).toContain('requires video')
    expect(JSON.stringify(messages[1])).toContain('video_path')
  })
})
