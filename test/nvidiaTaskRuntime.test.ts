import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNvidiaHostedTask } from '../src/services/providers/nvidiaTaskRuntime.js'
import { ProviderHTTPError } from '../src/services/api/providerHttp.js'
import {
  clearProviderModelCacheForTests,
  listModelsForProviderWithSource,
} from '../src/services/providers/providerRegistry.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ur-nvidia-task-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  clearProviderModelCacheForTests()
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('NVIDIA hosted one-shot task runtime', () => {
  test('routes FLUX to its exact endpoint and writes the JPEG artifact', async () => {
    const cwd = await temporaryDirectory()
    const requests: Array<{
      url: string
      authorization: string | null
      body: Record<string, unknown>
    }> = []
    const result = await runNvidiaHostedTask(
      {
        model: 'black-forest-labs/flux.1-schnell',
        prompt: 'A clean product photograph of a brass compass',
        width: 1216,
        height: 832,
        steps: 3,
        seed: 42,
      },
      {
        apiKey: 'nvapi-test',
        cwd,
        now: () => 1234,
        fetch: async (input, init) => {
          requests.push({
            url: String(input),
            authorization: new Headers(init?.headers).get('authorization'),
            body: JSON.parse(String(init?.body)),
          })
          return Response.json({
            artifacts: [
              {
                base64: Buffer.from('jpeg-bytes').toString('base64'),
                finishReason: 'SUCCESS',
                seed: 42,
              },
            ],
          })
        },
      },
    )

    expect(requests).toEqual([
      {
        url: 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell',
        authorization: 'Bearer nvapi-test',
        body: {
          prompt: 'A clean product photograph of a brass compass',
          width: 1216,
          height: 832,
          cfg_scale: 0,
          mode: 'base',
          samples: 1,
          seed: 42,
          steps: 3,
        },
      },
    ])
    expect(result).toMatchObject({
      model: 'black-forest-labs/flux.1-schnell',
      taskKind: 'image-generation',
      outputPath: join(cwd, '.ur', 'artifacts', 'nvidia', '1234.jpg'),
      mediaType: 'image/jpeg',
      seed: 42,
      finishReason: 'SUCCESS',
    })
    expect(await readFile(result.outputPath!, 'utf8')).toBe('jpeg-bytes')
  })

  test('polls an asynchronous video job and writes the MP4 artifact', async () => {
    const cwd = await temporaryDirectory()
    const imagePath = join(cwd, 'source.png')
    await writeFile(imagePath, Buffer.from('small-png'))
    const requests: string[] = []
    const result = await runNvidiaHostedTask(
      {
        model: 'stabilityai/stable-video-diffusion',
        imagePath,
        outputPath: 'result.mp4',
        cfgScale: 2.5,
      },
      {
        apiKey: 'nvapi-test',
        cwd,
        pollDelayMs: 0,
        fetch: async input => {
          requests.push(String(input))
          if (requests.length === 1) {
            return new Response('', {
              status: 202,
              headers: { 'NVCF-REQID': 'request-123' },
            })
          }
          return Response.json({
            video: Buffer.from('mp4-bytes').toString('base64'),
            finish_reason: 'SUCCESS',
            seed: 9,
          })
        },
      },
    )

    expect(requests).toEqual([
      'https://ai.api.nvidia.com/v1/genai/stabilityai/stable-video-diffusion',
      'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/request-123',
    ])
    expect(result.outputPath).toBe(join(cwd, 'result.mp4'))
    expect(await readFile(result.outputPath!, 'utf8')).toBe('mp4-bytes')
    expect(result).toMatchObject({
      taskKind: 'video-generation',
      mediaType: 'video/mp4',
      finishReason: 'SUCCESS',
      seed: 9,
    })
  })

  test('routes PaliGemma as one image plus one prompt and returns text', async () => {
    const cwd = await temporaryDirectory()
    const imagePath = join(cwd, 'diagram.jpg')
    await writeFile(imagePath, Buffer.from('jpeg'))
    let body: any
    const result = await runNvidiaHostedTask(
      {
        model: 'google/paligemma',
        imagePath,
        prompt: 'What does this diagram show?',
        maxTokens: 256,
      },
      {
        apiKey: 'nvapi-test',
        cwd,
        fetch: async (input, init) => {
          expect(String(input)).toBe(
            'https://ai.api.nvidia.com/v1/vlm/google/paligemma',
          )
          body = JSON.parse(String(init?.body))
          return Response.json({
            choices: [
              { message: { role: 'assistant', content: 'A three-stage data flow.' } },
            ],
          })
        },
      },
    )

    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]).toMatchObject({ role: 'user' })
    expect(body.messages[0].content[0]).toEqual({
      type: 'text',
      text: 'What does this diagram show?',
    })
    expect(body.messages[0].content[1].image_url.url).toStartWith(
      'data:image/jpeg;base64,',
    )
    expect(body.max_tokens).toBe(256)
    expect(result).toMatchObject({
      model: 'google/paligemma',
      taskKind: 'image-understanding',
      text: 'A three-stage data flow.',
    })
  })

  test('rejects unknown models and schema violations before network I/O', async () => {
    const cwd = await temporaryDirectory()
    let fetched = false
    const options = {
      apiKey: 'nvapi-test',
      cwd,
      fetch: async () => {
        fetched = true
        return Response.json({})
      },
    }

    await expect(
      runNvidiaHostedTask(
        { model: 'vendor/not-hosted', prompt: 'Describe it.' },
        options,
      ),
    ).rejects.toThrow('has no public hosted task contract')
    await expect(
      runNvidiaHostedTask(
        {
          model: 'black-forest-labs/flux.1-schnell',
          prompt: 'test',
          width: 1000,
        },
        options,
      ),
    ).rejects.toThrow('must be one of')
    expect(fetched).toBe(false)
  })

  test('uploads large media through NVIDIA Assets and removes the temporary asset after inference', async () => {
    const cwd = await temporaryDirectory()
    const imagePath = join(cwd, 'large.png')
    await writeFile(imagePath, Buffer.alloc(200 * 1024, 7))
    const requests: Array<{ url: string; method: string; body?: string }> = []
    const result = await runNvidiaHostedTask(
      {
        model: 'nvidia/vila',
        prompt: 'Describe the image.',
        imagePath,
      },
      {
        apiKey: 'nvapi-test',
        cwd,
        fetch: async (input, init) => {
          const url = String(input)
          requests.push({
            url,
            method: init?.method ?? 'GET',
            ...(typeof init?.body === 'string' ? { body: init.body } : {}),
          })
          if (url === 'https://api.nvcf.nvidia.com/v2/nvcf/assets') {
            return Response.json({
              assetId: 'asset-123',
              uploadUrl: 'https://uploads.example/asset-123',
            })
          }
          if (url === 'https://uploads.example/asset-123') {
            return new Response('', { status: 200 })
          }
          if (url.endsWith('/assets/asset-123')) {
            return new Response('', { status: 204 })
          }
          expect(url).toBe('https://ai.api.nvidia.com/v1/vlm/nvidia/vila')
          const payload = JSON.parse(String(init?.body))
          expect(payload.messages[0].content[1].image_url.url).toBe(
            'data:image/png;asset_id,asset-123',
          )
          return Response.json({
            choices: [{ message: { content: 'A large test image.' } }],
          })
        },
      },
    )

    expect(result.text).toBe('A large test image.')
    expect(requests.map(request => [request.method, request.url])).toEqual([
      ['POST', 'https://api.nvcf.nvidia.com/v2/nvcf/assets'],
      ['PUT', 'https://uploads.example/asset-123'],
      ['POST', 'https://ai.api.nvidia.com/v1/vlm/nvidia/vila'],
      ['DELETE', 'https://api.nvcf.nvidia.com/v2/nvcf/assets/asset-123'],
    ])
  })

  test('routes structured reranking and healthcare payloads to their exact API families', async () => {
    const cwd = await temporaryDirectory()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      })
      return Response.json({ result: 'ok' })
    }
    await runNvidiaHostedTask(
      {
        model: 'nvidia/llama-nemotron-rerank-1b-v2',
        query: 'best route',
        passages: ['first', 'second'],
      },
      { apiKey: 'nvapi-test', cwd, fetch },
    )
    await runNvidiaHostedTask(
      {
        model: 'arc/evo2-40b',
        payload: { sequence: 'ACGT', num_tokens: 8 },
      },
      { apiKey: 'nvapi-test', cwd, fetch },
    )

    expect(requests[0]).toMatchObject({
      url: 'https://ai.api.nvidia.com/v1/retrieval/nvidia/llama-nemotron-rerank-1b-v2/reranking',
      body: {
        model: 'nvidia/llama-nemotron-rerank-1b-v2',
        query: { text: 'best route' },
        passages: [{ text: 'first' }, { text: 'second' }],
      },
    })
    expect(requests[1]).toMatchObject({
      url: 'https://health.api.nvidia.com/v1/biology/arc/evo2-40b/generate',
      body: { sequence: 'ACGT', num_tokens: 8 },
    })
  })

  test('redacts NVIDIA function and account identifiers from task failures', async () => {
    const cwd = await temporaryDirectory()
    const available = await listModelsForProviderWithSource('nvidia-nim', {
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: async () =>
          Response.json({
            data: [{ id: 'black-forest-labs/flux.1-schnell' }],
          }),
      },
    })
    expect(available.models.map(model => model.id)).toEqual(
      expect.arrayContaining(['black-forest-labs/flux.1-schnell']),
    )
    let caught: unknown
    try {
      await runNvidiaHostedTask(
        {
          model: 'black-forest-labs/flux.1-schnell',
          prompt: 'test',
        },
        {
          apiKey: 'nvapi-test',
          cwd,
          fetch: async () =>
            Response.json(
              {
                detail:
                  "Function '23bd454d-b225-49a3-8118-582a62fc51b8': Not found for account 'VSB91X1Z9SXUUs3B5SLm16YDcaBh5gNB2kOOsW8Sdxo'",
              },
              { status: 404 },
            ),
        },
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ProviderHTTPError)
    expect((caught as Error).message).toContain('not enabled for this API key')
    expect((caught as Error).message).not.toContain('23bd454d')
    expect((caught as Error).message).not.toContain('VSB91X1')
    expect((caught as ProviderHTTPError).body).toBeUndefined()

    const afterFailure = await listModelsForProviderWithSource('nvidia-nim', {
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: async () => {
          throw new Error('fresh discovery should not run while cache is warm')
        },
      },
    })
    expect(afterFailure.models.some(model => model.id === 'black-forest-labs/flux.1-schnell')).toBe(false)
    expect(afterFailure.models.length).toBeGreaterThan(80)
  })
})
