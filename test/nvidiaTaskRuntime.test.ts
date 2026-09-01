import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderHTTPError } from '../src/services/api/providerHttp.js'
import { inspectNativeNvidiaGrpcContract } from '../src/services/providers/nvidiaGrpcRuntime.js'
import {
  getNvidiaHostedTaskModelContract,
  NVIDIA_HOSTED_TASK_MODEL_CONTRACTS,
} from '../src/services/providers/nvidiaHostedModels.js'
import { runNvidiaHostedTask } from '../src/services/providers/nvidiaTaskRuntime.js'
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

describe('NVIDIA Special exact-contract runtime', () => {
  test('every executable task has a model-card inference contract', () => {
    const executable = NVIDIA_HOSTED_TASK_MODEL_CONTRACTS.filter(
      contract => contract.executable,
    )
    expect(NVIDIA_HOSTED_TASK_MODEL_CONTRACTS).toHaveLength(23)
    expect(executable).toHaveLength(22)
    expect(
      executable.every(
        contract =>
          contract.endpoint &&
          contract.method &&
          contract.documentation &&
          contract.buildCard &&
          Object.keys(contract.requestSchema).length > 0 &&
          Object.keys(contract.responseSchema).length > 0,
      ),
    ).toBe(true)
  })

  test('routes PaliGemma to its documented VLM endpoint', async () => {
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
          expect(init?.method).toBe('POST')
          body = JSON.parse(String(init?.body))
          return Response.json({
            choices: [
              { message: { role: 'assistant', content: 'A three-stage data flow.' } },
            ],
          })
        },
      },
    )

    expect(body.messages[0].content[0]).toEqual({
      type: 'text',
      text: 'What does this diagram show?',
    })
    expect(body.messages[0].content[1].type).toBe('image_url')
    expect(body.messages[0].content[1].image_url.url).toStartWith(
      'data:image/jpeg;base64,',
    )
    expect(body).toMatchObject({ max_tokens: 256, stream: false })
    expect(result).toMatchObject({
      model: 'google/paligemma',
      taskKind: 'image-understanding',
      text: 'A three-stage data flow.',
    })
  })

  test('uses the exact Cosmos Transfer request and decodes its MP4 response', async () => {
    const cwd = await temporaryDirectory()
    const videoPath = join(cwd, 'source.mp4')
    await writeFile(videoPath, Buffer.from('mp4-input'))
    let body: any
    const result = await runNvidiaHostedTask(
      {
        model: 'nvidia/cosmos-transfer1-7b',
        prompt: 'Turn the scene into a rainy night.',
        videoPath,
        seed: 42,
        cfgScale: 7,
        steps: 20,
      },
      {
        apiKey: 'nvapi-test',
        cwd,
        now: () => 1_000,
        fetch: async (input, init) => {
          expect(String(input)).toBe(
            'https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos-transfer1-7b',
          )
          body = JSON.parse(String(init?.body))
          return Response.json({
            b64_video: Buffer.from('mp4-output').toString('base64'),
            seed: 42,
          })
        },
      },
    )

    expect(body).toMatchObject({
      prompt: 'Turn the scene into a rainy night.',
      seed: 42,
      guidance_scale: 7,
      steps: 20,
    })
    expect(body.video).toStartWith('data:video/mp4;base64,')
    expect(result).toMatchObject({
      model: 'nvidia/cosmos-transfer1-7b',
      taskKind: 'video-generation',
      outputPath: join(cwd, '.ur', 'artifacts', 'nvidia', '1000.mp4'),
      mediaType: 'video/mp4',
      seed: 42,
    })
    expect(await readFile(result.outputPath!, 'utf8')).toBe('mp4-output')
  })

  test('polls the documented asynchronous NVCF status route', async () => {
    const cwd = await temporaryDirectory()
    const requests: string[] = []
    const result = await runNvidiaHostedTask(
      {
        model: 'nvidia/cosmos3-nano',
        prompt: 'A robot walks through a warehouse.',
      },
      {
        apiKey: 'nvapi-test',
        cwd,
        now: () => 1_500,
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
            b64_video: Buffer.from('cosmos-video').toString('base64'),
          })
        },
      },
    )

    expect(requests).toEqual([
      'https://ai.api.nvidia.com/v1/infer',
      'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/request-123',
    ])
    expect(await readFile(result.outputPath!, 'utf8')).toBe('cosmos-video')
  })

  test('uses the card-specific NVCF function route and saves all BEV artifacts', async () => {
    const cwd = await temporaryDirectory()
    let requestBody: unknown
    const result = await runNvidiaHostedTask(
      {
        model: 'nvidia/bevformer',
        prompt: 'scene-0103',
      },
      {
        apiKey: 'nvapi-test',
        cwd,
        now: () => 2_000,
        fetch: async (input, init) => {
          expect(String(input)).toBe(
            'https://9b12b22f-f97f-4141-86af-a7deb04a21a5.invocation.api.nvcf.nvidia.com/v1/bevformer/process',
          )
          requestBody = JSON.parse(String(init?.body))
          return Response.json({
            inference_metadata: { data: { scene_id: 'scene-0103' } },
            camera_video: {
              data: Buffer.from('camera-video').toString('base64'),
              mime_type: 'video/mp4',
            },
            bev_video: {
              data: Buffer.from('bev-video').toString('base64'),
              mime_type: 'video/mp4',
            },
          })
        },
      },
    )

    expect(requestBody).toEqual({ scene_id: 'scene-0103' })
    expect(result.artifacts).toEqual([
      {
        label: 'camera-video',
        path: join(cwd, '.ur', 'artifacts', 'nvidia', '2000.mp4'),
        mediaType: 'video/mp4',
      },
      {
        label: 'bev-video',
        path: join(cwd, '.ur', 'artifacts', 'nvidia', '2001.mp4'),
        mediaType: 'video/mp4',
      },
    ])
    expect(await readFile(result.artifacts![0]!.path, 'utf8')).toBe('camera-video')
    expect(await readFile(result.artifacts![1]!.path, 'utf8')).toBe('bev-video')
  })

  test('uploads oversized media through NVIDIA Assets and always deletes it', async () => {
    const cwd = await temporaryDirectory()
    const imagePath = join(cwd, 'large.png')
    await writeFile(imagePath, Buffer.alloc(200 * 1024, 7))
    const requests: Array<{ url: string; method: string }> = []
    const result = await runNvidiaHostedTask(
      {
        model: 'google/paligemma',
        prompt: 'Describe this image.',
        imagePath,
      },
      {
        apiKey: 'nvapi-test',
        cwd,
        fetch: async (input, init) => {
          const url = String(input)
          requests.push({ url, method: init?.method ?? 'GET' })
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
    expect(requests).toEqual([
      { method: 'POST', url: 'https://api.nvcf.nvidia.com/v2/nvcf/assets' },
      { method: 'PUT', url: 'https://uploads.example/asset-123' },
      {
        method: 'POST',
        url: 'https://ai.api.nvidia.com/v1/vlm/google/paligemma',
      },
      {
        method: 'DELETE',
        url: 'https://api.nvcf.nvidia.com/v2/nvcf/assets/asset-123',
      },
    ])
  })

  test('routes embeddings with the exact documented payload', async () => {
    const cwd = await temporaryDirectory()
    let body: unknown
    const result = await runNvidiaHostedTask(
      {
        model: 'nvidia/nemotron-3-embed-1b',
        prompt: 'semantic search input',
        payload: { input_type: 'query' },
      },
      {
        apiKey: 'nvapi-test',
        cwd,
        fetch: async (input, init) => {
          expect(String(input)).toBe(
            'https://integrate.api.nvidia.com/v1/embeddings',
          )
          body = JSON.parse(String(init?.body))
          return Response.json({
            object: 'list',
            data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
            model: 'nvidia/nemotron-3-embed-1b',
            usage: { prompt_tokens: 3, total_tokens: 3 },
          })
        },
      },
    )

    expect(body).toEqual({
      input_type: 'query',
      encoding_format: 'float',
      truncate: 'NONE',
      model: 'nvidia/nemotron-3-embed-1b',
      input: 'semantic search input',
    })
    expect(JSON.parse(result.text!)).toMatchObject({
      data: [{ embedding: [0.1, 0.2] }],
    })
  })

  test('rejects unknown, unpublished, and schema-invalid requests before I/O', async () => {
    const cwd = await temporaryDirectory()
    const videoPath = join(cwd, 'source.mp4')
    await writeFile(videoPath, Buffer.from('mp4'))
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
          model: 'nvidia/cosmos-transfer1-7b',
          prompt: 'test',
          videoPath,
          cfgScale: 21,
        },
        options,
      ),
    ).rejects.toThrow('must be at most 20')
    await expect(
      runNvidiaHostedTask(
        {
          model: 'nvidia/cosmos-transfer1-7b',
          prompt: 'test',
          videoPath,
          payload: { undocumented_option: true },
        },
        options,
      ),
    ).rejects.toThrow("is not part of NVIDIA's documented schema")
    await expect(
      runNvidiaHostedTask(
        { model: 'nvidia/nemotron-voicechat' },
        { ...options, apiKey: '' },
      ),
    ).rejects.toThrow('has not published an inference request/response contract')
    expect(fetched).toBe(false)
  })

  test('loads all five exact public gRPC services and streaming shapes', async () => {
    const expected = [
      {
        model: 'nvidia/active-speaker-detection',
        path: '/nvidia.ai4m.activespeakerdetection.v1.ActiveSpeakerDetectionService/DetectActiveSpeaker',
        requestStream: true,
        responseStream: true,
      },
      {
        model: 'nvidia/bnr',
        path: '/nvidia.ai4m.bnr.v1.BNR/EnhanceAudio',
        requestStream: true,
        responseStream: true,
      },
      {
        model: 'nvidia/magpie-tts-zeroshot',
        path: '/nvidia.riva.tts.RivaSpeechSynthesis/Synthesize',
        requestStream: false,
        responseStream: false,
      },
      {
        model: 'nvidia/studiovoice',
        path: '/nvidia.ai4m.studiovoice.v1.StudioVoice/EnhanceAudio',
        requestStream: true,
        responseStream: true,
      },
      {
        model: 'nvidia/synthetic-video-detector',
        path: '/nvidia.maxine.syntheticvideodetector.v1.SyntheticVideoDetectorService/DetectSyntheticVideo',
        requestStream: true,
        responseStream: true,
      },
    ] as const

    for (const entry of expected) {
      const contract = getNvidiaHostedTaskModelContract(entry.model)!
      const inspected = await inspectNativeNvidiaGrpcContract(entry.model)
      expect(inspected).toMatchObject({
        path: entry.path,
        requestStream: entry.requestStream,
        responseStream: entry.responseStream,
      })
      expect(inspected?.service).toBe(contract.rpcService)
      expect(inspected?.method).toBe(contract.rpcMethod)
      expect(contract.endpoint).toBe('grpc.nvcf.nvidia.com:443')
      expect(contract.functionId).toBeTruthy()
    }
  })

  test('redacts account identifiers and never removes a rejected model', async () => {
    const cwd = await temporaryDirectory()
    let caught: unknown
    try {
      await runNvidiaHostedTask(
        { model: 'google/paligemma', prompt: 'test' },
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
    expect((caught as Error).message).toContain('UR kept it in the catalog')
    expect((caught as Error).message).not.toContain('23bd454d')
    expect((caught as Error).message).not.toContain('VSB91X1')
    expect((caught as ProviderHTTPError).body).toBeUndefined()

    const afterFailure = await listModelsForProviderWithSource('nvidia-special')
    expect(afterFailure.models.map(model => model.id)).toContain('google/paligemma')
    expect(afterFailure.models).toHaveLength(23)
  })
})
