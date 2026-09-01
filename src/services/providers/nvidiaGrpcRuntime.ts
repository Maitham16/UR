/**
 * Native NVIDIA Build gRPC task execution.
 *
 * The protocol fragments below are the exact public wire fields used by the
 * NVIDIA Riva and NVIDIA Maxine clients. They are intentionally embedded so
 * the published UR CLI does not depend on Python, grpcurl, protoc, or a cloned
 * repository at runtime. Original definitions are MIT licensed by NVIDIA:
 * https://github.com/NVIDIA-Maxine/nim-clients and
 * https://github.com/nvidia-riva/common.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import type { NvidiaHostedTaskModelContract } from './nvidiaHostedModels.js'

const CHUNK_BYTES = 64 * 1024
const PROTO_DIR = join(tmpdir(), 'ur-nexus-nvidia-protos-v1')

const PROTOS: Record<string, string> = {
  'bnr.proto': `
syntax = "proto3";
package nvidia.ai4m.bnr.v1;
service BNR { rpc EnhanceAudio(stream EnhanceAudioRequest) returns (stream EnhanceAudioResponse); }
message EnhanceAudioConfig { optional float intensity_ratio = 1; }
message EnhanceAudioRequest { oneof stream_input { bytes audio_stream_data = 1; EnhanceAudioConfig config = 2; } }
message EnhanceAudioResponse { oneof stream_output { bytes audio_stream_data = 1; EnhanceAudioConfig config = 2; } }
`,
  'studio-voice.proto': `
syntax = "proto3";
package nvidia.ai4m.studiovoice.v1;
service StudioVoice { rpc EnhanceAudio(stream EnhanceAudioRequest) returns (stream EnhanceAudioResponse); }
message EnhanceAudioRequest { oneof stream_input { bytes audio_stream_data = 1; } }
message EnhanceAudioResponse { oneof stream_output { bytes audio_stream_data = 1; } }
`,
  'synthetic-video-detector.proto': `
syntax = "proto3";
package nvidia.maxine.syntheticvideodetector.v1;
service SyntheticVideoDetectorService { rpc DetectSyntheticVideo(stream DetectSyntheticVideoRequest) returns (stream DetectSyntheticVideoResponse); }
message Empty {}
message DetectSyntheticVideoRequest { bytes video_file_data = 1; }
message ClipResult { uint32 index = 1; float logit = 2; }
message VideoResult { float logit = 1; float probability = 2; string csv_data = 3; uint32 total_clips = 4; }
message DetectSyntheticVideoResponse { oneof stream_output { ClipResult clip_result = 1; VideoResult final_result = 2; Empty keepalive = 3; } }
`,
  'active-speaker-detection.proto': `
syntax = "proto3";
package nvidia.ai4m.activespeakerdetection.v1;
service ActiveSpeakerDetectionService { rpc DetectActiveSpeaker(stream DetectActiveSpeakerRequest) returns (stream DetectActiveSpeakerResponse); }
message Empty {}
enum AudioCodec { AUDIO_CODEC_UNSPECIFIED = 0; AUDIO_CODEC_MP3 = 1; AUDIO_CODEC_WAV = 2; AUDIO_CODEC_OPUS = 3; }
enum AudioFormat { AUDIO_FORMAT_UNSPECIFIED = 0; AUDIO_FORMAT_S16LE = 1; }
message AudioConfig { AudioCodec encoding = 1; optional AudioFormat format = 2; optional uint32 bitrate_kbps = 3; }
message LossyEncoding { optional uint32 bitrate_mbps = 1; optional uint32 idr_interval = 2; }
message VideoEncoding { oneof encoding_type { bool lossless = 1; LossyEncoding lossy = 2; } }
enum VideoCodec { VIDEO_CODEC_UNSPECIFIED = 0; VIDEO_CODEC_H264 = 1; }
message VideoConfig { VideoEncoding encoding = 1; optional VideoCodec codec = 2; }
message BoundingBox { float x = 1; float y = 2; float width = 3; float height = 4; }
message DetectActiveSpeakerRequest { oneof active_speaker_detection_request { ActiveSpeakerDetectionConfig config = 1; ActiveSpeakerDetectionData data = 2; } }
enum AudioSourceConfig { AUDIO_SOURCE_CONFIG_UNSPECIFIED = 0; AUDIO_SOURCE_CONFIG_SEPARATE_STREAM = 1; AUDIO_SOURCE_CONFIG_EMBEDDED_IN_VIDEO = 2; }
message ActiveSpeakerDetectionConfig { AudioConfig input_audio_config = 1; VideoConfig input_video_config = 2; AudioSourceConfig audio_source_config = 3; optional float speaker_detection_threshold = 4; }
message ActiveSpeakerDetectionData { optional bytes video_data = 1; optional bytes audio_data = 2; optional AudioDiarizationInfo diarization_info = 3; }
message AudioDiarizationInfo { repeated AudioSegmentInfo segments = 1; optional string transcript = 2; }
message AudioSegmentInfo { uint32 start_time = 1; uint32 end_time = 2; int32 speaker_id = 3; optional string word = 4; optional string language_code = 5; }
message SpeakerInfo { BoundingBox speaker_bbox = 1; int32 diarized_speaker_id = 2; int32 face_id = 3; bool is_speaking = 4; float face_detection_confidence = 5; }
message ActiveSpeakerDetectionResult { uint32 frame_id = 1; repeated SpeakerInfo speaker_data = 2; }
message DetectActiveSpeakerResponse { oneof response { ActiveSpeakerDetectionConfig config = 1; ActiveSpeakerDetectionResult active_speaker_detection_result = 2; Empty keepalive = 3; } }
`,
  'riva-tts.proto': `
syntax = "proto3";
package nvidia.riva.tts;
service RivaSpeechSynthesis { rpc Synthesize(SynthesizeSpeechRequest) returns (SynthesizeSpeechResponse); }
enum AudioEncoding { ENCODING_UNSPECIFIED = 0; LINEAR_PCM = 1; FLAC = 2; MULAW = 3; OGGOPUS = 4; ALAW = 20; }
message ZeroShotData { bytes audio_prompt = 1; int32 sample_rate_hz = 2; AudioEncoding encoding = 3; int32 quality = 4; string transcript = 5; }
message SynthesizeSpeechRequest { string text = 1; string language_code = 2; AudioEncoding encoding = 3; int32 sample_rate_hz = 4; string voice_name = 5; ZeroShotData zero_shot_data = 6; string custom_dictionary = 7; map<string, string> custom_configuration = 8; bool enable_word_time_offsets = 9; }
message WordTiming { string word = 1; int32 start_time = 2; int32 end_time = 3; }
message SynthesizeSpeechResponseMetadata { string text = 1; string processed_text = 2; repeated float predicted_durations = 8; repeated WordTiming words = 9; }
message SynthesizeSpeechResponse { bytes audio = 1; SynthesizeSpeechResponseMetadata meta = 2; }
`,
}

type JsonObject = Record<string, unknown>
type DynamicClient = grpc.Client & Record<string, (...args: unknown[]) => unknown>

export type NvidiaGrpcRequest = {
  prompt?: string
  inputPath?: string
  audioPath?: string
  videoPath?: string
  referenceAudioPath?: string
  diarizationPath?: string
  outputPath?: string
  payload?: JsonObject
}

export type NvidiaGrpcOptions = {
  apiKey: string
  cwd: string
  signal?: AbortSignal
  now?: () => number
}

export type NvidiaGrpcResult = {
  outputPath?: string
  mediaType?: string
  text?: string
}

type GrpcDescriptor = {
  proto: keyof typeof PROTOS
  service: string
  method: string
}

const DESCRIPTORS: Record<string, GrpcDescriptor> = {
  'nvidia/active-speaker-detection': {
    proto: 'active-speaker-detection.proto',
    service:
      'nvidia.ai4m.activespeakerdetection.v1.ActiveSpeakerDetectionService',
    method: 'DetectActiveSpeaker',
  },
  'nvidia/bnr': {
    proto: 'bnr.proto',
    service: 'nvidia.ai4m.bnr.v1.BNR',
    method: 'EnhanceAudio',
  },
  'nvidia/magpie-tts-zeroshot': {
    proto: 'riva-tts.proto',
    service: 'nvidia.riva.tts.RivaSpeechSynthesis',
    method: 'Synthesize',
  },
  'nvidia/studiovoice': {
    proto: 'studio-voice.proto',
    service: 'nvidia.ai4m.studiovoice.v1.StudioVoice',
    method: 'EnhanceAudio',
  },
  'nvidia/synthetic-video-detector': {
    proto: 'synthetic-video-detector.proto',
    service:
      'nvidia.maxine.syntheticvideodetector.v1.SyntheticVideoDetectorService',
    method: 'DetectSyntheticVideo',
  },
}

function jsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

async function ensureProto(name: keyof typeof PROTOS): Promise<string> {
  const path = join(PROTO_DIR, name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, PROTOS[name], { encoding: 'utf8', flag: 'w' })
  return path
}

function nested(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    const object = jsonObject(value)
    return object?.[key]
  }, root)
}

async function clientFor(
  contract: NvidiaHostedTaskModelContract,
  descriptor: GrpcDescriptor,
): Promise<DynamicClient> {
  const definition = protoLoader.loadSync(await ensureProto(descriptor.proto), {
    defaults: true,
    enums: String,
    keepCase: false,
    longs: String,
    oneofs: true,
  })
  const root = grpc.loadPackageDefinition(definition)
  const Constructor = nested(root, descriptor.service)
  if (typeof Constructor !== 'function') {
    throw new Error(`NVIDIA gRPC service ${descriptor.service} was not loaded.`)
  }
  return new (Constructor as new (
    address: string,
    credentials: grpc.ChannelCredentials,
    options: grpc.ChannelOptions,
  ) => DynamicClient)(contract.endpoint, grpc.credentials.createSsl(), {
    'grpc.max_receive_message_length': 1024 * 1024 * 1024,
    'grpc.max_send_message_length': 1024 * 1024 * 1024,
  })
}

export type NvidiaGrpcContractInspection = {
  service: string
  method: string
  path: string
  requestStream: boolean
  responseStream: boolean
}

/** Load and inspect the embedded public proto without opening a connection. */
export async function inspectNativeNvidiaGrpcContract(
  model: string,
): Promise<NvidiaGrpcContractInspection | undefined> {
  const descriptor = DESCRIPTORS[model.trim().toLowerCase()]
  if (!descriptor) return undefined
  const definition = protoLoader.loadSync(await ensureProto(descriptor.proto), {
    defaults: true,
    enums: String,
    keepCase: false,
    longs: String,
    oneofs: true,
  })
  const service = definition[descriptor.service] as
    | Record<string, { path?: string; requestStream?: boolean; responseStream?: boolean }>
    | undefined
  const method = service?.[descriptor.method]
  if (!method?.path) {
    throw new Error(
      `NVIDIA gRPC descriptor ${descriptor.service}/${descriptor.method} was not loaded.`,
    )
  }
  return {
    service: descriptor.service,
    method: descriptor.method,
    path: method.path,
    requestStream: method.requestStream === true,
    responseStream: method.responseStream === true,
  }
}

function metadata(contract: NvidiaHostedTaskModelContract, apiKey: string): grpc.Metadata {
  const value = new grpc.Metadata()
  value.set('authorization', `Bearer ${apiKey}`)
  if (contract.functionId) value.set('function-id', contract.functionId)
  return value
}

function absolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path)
}

async function bytes(path: string, cwd: string): Promise<Buffer> {
  return readFile(absolute(path, cwd))
}

function requiredPath(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required for this NVIDIA gRPC task.`)
  return value.trim()
}

function chunks(value: Buffer): Buffer[] {
  const output: Buffer[] = []
  for (let offset = 0; offset < value.length; offset += CHUNK_BYTES) {
    output.push(value.subarray(offset, Math.min(value.length, offset + CHUNK_BYTES)))
  }
  return output
}

function defaultOutputPath(cwd: string, model: string, extension: string, now: () => number): string {
  const safeModel = model.split('/').at(-1)?.replace(/[^a-z0-9._-]+/giu, '-') ?? 'result'
  return join(cwd, '.ur', 'artifacts', 'nvidia', `${now()}-${safeModel}${extension}`)
}

async function save(
  value: Uint8Array | string,
  requested: string | undefined,
  extension: string,
  contract: NvidiaHostedTaskModelContract,
  options: NvidiaGrpcOptions,
): Promise<string> {
  const output = requested
    ? absolute(requested, options.cwd)
    : defaultOutputPath(
        options.cwd,
        contract.id,
        extension,
        options.now ?? Date.now,
      )
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, value)
  return output
}

function grpcError(model: string, error: unknown): Error {
  const status = error as Partial<grpc.ServiceError>
  const detail = String(status.details ?? status.message ?? error)
    .replace(/account\s+['"][^'"]+['"]/giu, 'account [redacted]')
    .slice(0, 2_000)
  return new Error(`NVIDIA gRPC inference failed for ${model}: ${detail}`)
}

async function bidi(
  client: DynamicClient,
  descriptor: GrpcDescriptor,
  requestMetadata: grpc.Metadata,
  messages: JsonObject[],
  signal: AbortSignal | undefined,
): Promise<JsonObject[]> {
  return new Promise((resolveCall, rejectCall) => {
    const method = client[descriptor.method]
    if (typeof method !== 'function') {
      rejectCall(new Error(`NVIDIA gRPC method ${descriptor.method} is unavailable.`))
      return
    }
    const call = method.call(client, requestMetadata) as grpc.ClientDuplexStream<
      JsonObject,
      JsonObject
    >
    const responses: JsonObject[] = []
    const abort = () => call.cancel()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    call.on('data', response => responses.push(response))
    call.on('error', error => {
      signal?.removeEventListener('abort', abort)
      rejectCall(error)
    })
    call.on('end', () => {
      signal?.removeEventListener('abort', abort)
      resolveCall(responses)
    })
    for (const message of messages) call.write(message)
    call.end()
  })
}

function wavFromPcm(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function audioEnhancement(
  contract: NvidiaHostedTaskModelContract,
  descriptor: GrpcDescriptor,
  request: NvidiaGrpcRequest,
  options: NvidiaGrpcOptions,
): Promise<NvidiaGrpcResult> {
  const input = request.audioPath ?? request.inputPath
  const content = await bytes(requiredPath(input, 'audio_path or input_path'), options.cwd)
  const messages: JsonObject[] = []
  if (contract.id === 'nvidia/bnr' && typeof request.payload?.intensity_ratio === 'number') {
    messages.push({ config: { intensityRatio: request.payload.intensity_ratio } })
  }
  messages.push(...chunks(content).map(audioStreamData => ({ audioStreamData })))
  const client = await clientFor(contract, descriptor)
  try {
    const responses = await bidi(
      client,
      descriptor,
      metadata(contract, options.apiKey),
      messages,
      options.signal,
    )
    const output = Buffer.concat(
      responses.flatMap(response =>
        Buffer.isBuffer(response.audioStreamData)
          ? [response.audioStreamData]
          : [],
      ),
    )
    if (output.length === 0) throw new Error('NVIDIA returned no enhanced audio bytes.')
    return {
      outputPath: await save(output, request.outputPath, '.wav', contract, options),
      mediaType: 'audio/wav',
    }
  } finally {
    client.close()
  }
}

async function syntheticVideo(
  contract: NvidiaHostedTaskModelContract,
  descriptor: GrpcDescriptor,
  request: NvidiaGrpcRequest,
  options: NvidiaGrpcOptions,
): Promise<NvidiaGrpcResult> {
  const input = request.videoPath ?? request.inputPath
  const content = await bytes(requiredPath(input, 'video_path or input_path'), options.cwd)
  const client = await clientFor(contract, descriptor)
  try {
    const responses = await bidi(
      client,
      descriptor,
      metadata(contract, options.apiKey),
      chunks(content).map(videoFileData => ({ videoFileData })),
      options.signal,
    )
    const clips = responses.flatMap(response => {
      const clip = jsonObject(response.clipResult)
      return clip ? [clip] : []
    })
    const final = responses
      .map(response => jsonObject(response.finalResult))
      .find(Boolean)
    const result = {
      verdict:
        typeof final?.probability === 'number'
          ? final.probability > 0.5
            ? 'synthetic'
            : 'real'
          : 'unknown',
      final,
      clips,
    }
    const text = JSON.stringify(result, null, 2)
    return request.outputPath
      ? {
          outputPath: await save(text, request.outputPath, '.json', contract, options),
          mediaType: 'application/json',
          text,
        }
      : { text }
  } finally {
    client.close()
  }
}

function numericSpeakerId(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  const match = String(value ?? '').match(/\d+/u)
  return match ? Number(match[0]) : 0
}

function diarization(value: unknown): { segments: JsonObject[]; transcript?: string } {
  const object = jsonObject(value) ?? {}
  const directSegments = Array.isArray(object.segments) ? object.segments : undefined
  const sampleWords = Array.isArray(object.words) ? object.words : undefined
  const rivaAlternatives = (Array.isArray(object.results) ? object.results : [])
    .flatMap(result => {
      const alternatives = jsonObject(result)?.alternatives
      return Array.isArray(alternatives) && alternatives.length > 0
        ? [jsonObject(alternatives[0])]
        : []
    })
    .filter((alternative): alternative is JsonObject => Boolean(alternative))
  const rivaWords = rivaAlternatives.flatMap(alternative =>
    Array.isArray(alternative.words) ? alternative.words : [],
  )
  const rawSegments = directSegments ?? sampleWords ?? rivaWords
  const sampleFormat = Boolean(sampleWords && !directSegments)
  const rivaFormat = Boolean(rivaWords.length > 0 && !directSegments && !sampleWords)
  const transcript =
    typeof object.transcript === 'string'
      ? object.transcript
      : typeof object.text === 'string'
        ? object.text
        : rivaAlternatives
            .flatMap(alternative =>
              typeof alternative.transcript === 'string'
                ? [alternative.transcript]
                : [],
            )
            .join(' ') || undefined
  return {
    segments: rawSegments.flatMap(segment => {
      const item = jsonObject(segment)
      if (!item) return []
      return [{
        startTime: sampleFormat
          ? Math.round(Number(item.start ?? 0) * 1_000)
          : item.start_time ?? item.startTime ?? 0,
        endTime: sampleFormat
          ? Math.round(Number(item.end ?? 0) * 1_000)
          : item.end_time ?? item.endTime ?? 0,
        speakerId: numericSpeakerId(
          rivaFormat
            ? item.speakerTag
            : item.speaker_id ?? item.speakerId,
        ),
        ...(typeof (item.word ?? item.text) === 'string'
          ? { word: item.word ?? item.text }
          : {}),
        ...(typeof (item.language_code ?? item.languageCode ?? object.language_code) === 'string'
          ? { languageCode: item.language_code ?? item.languageCode ?? object.language_code }
          : {}),
      }]
    }),
    ...(transcript ? { transcript } : {}),
  }
}

async function activeSpeaker(
  contract: NvidiaHostedTaskModelContract,
  descriptor: GrpcDescriptor,
  request: NvidiaGrpcRequest,
  options: NvidiaGrpcOptions,
): Promise<NvidiaGrpcResult> {
  const videoPath = request.videoPath ?? request.inputPath
  const video = await bytes(requiredPath(videoPath, 'video_path or input_path'), options.cwd)
  const audio = request.audioPath ? await bytes(request.audioPath, options.cwd) : undefined
  const diarizationValue = request.diarizationPath
    ? JSON.parse(await readFile(absolute(request.diarizationPath, options.cwd), 'utf8'))
    : request.payload?.diarization
  if (!diarizationValue) {
    throw new Error(
      'diarization_path or payload.diarization is required for NVIDIA Active Speaker Detection.',
    )
  }
  const messages: JsonObject[] = [{
    config: {
      inputVideoConfig: { codec: 'VIDEO_CODEC_H264' },
      inputAudioConfig: {
        encoding:
          request.audioPath
            ? extname(request.audioPath).toLowerCase() === '.mp3'
              ? 'AUDIO_CODEC_MP3'
              : /^\.(?:ogg|opus)$/u.test(extname(request.audioPath).toLowerCase())
                ? 'AUDIO_CODEC_OPUS'
                : 'AUDIO_CODEC_WAV'
            : 'AUDIO_CODEC_OPUS',
      },
      audioSourceConfig: audio
        ? 'AUDIO_SOURCE_CONFIG_SEPARATE_STREAM'
        : 'AUDIO_SOURCE_CONFIG_EMBEDDED_IN_VIDEO',
      ...(typeof request.payload?.speaker_detection_threshold === 'number'
        ? { speakerDetectionThreshold: request.payload.speaker_detection_threshold }
        : {}),
    },
  }]
  const parsedDiarization = diarization(diarizationValue)
  if (parsedDiarization.segments.length === 0) {
    throw new Error(
      'NVIDIA Active Speaker Detection requires at least one documented diarization segment.',
    )
  }
  const diarizationBatches: JsonObject[] = []
  for (let index = 0; index < parsedDiarization.segments.length; index += 100) {
    const final = index + 100 >= parsedDiarization.segments.length
    diarizationBatches.push({
      segments: parsedDiarization.segments.slice(index, index + 100),
      ...(final && parsedDiarization.transcript
        ? { transcript: parsedDiarization.transcript }
        : {}),
    })
  }
  const videoChunks = chunks(video)
  const audioChunks = audio ? chunks(audio) : []
  const length = Math.max(
    videoChunks.length,
    audioChunks.length,
    diarizationBatches.length,
  )
  for (let index = 0; index < length; index += 1) {
    if (videoChunks[index]) messages.push({ data: { videoData: videoChunks[index] } })
    if (audioChunks[index]) messages.push({ data: { audioData: audioChunks[index] } })
    if (diarizationBatches[index]) {
      messages.push({ data: { diarizationInfo: diarizationBatches[index] } })
    }
  }
  const client = await clientFor(contract, descriptor)
  try {
    const responses = await bidi(
      client,
      descriptor,
      metadata(contract, options.apiKey),
      messages,
      options.signal,
    )
    const frames = responses.flatMap(response => {
      const result = jsonObject(response.activeSpeakerDetectionResult)
      return result ? [result] : []
    })
    const text = JSON.stringify({ frames }, null, 2)
    return {
      outputPath: await save(text, request.outputPath, '.json', contract, options),
      mediaType: 'application/json',
      text: `${frames.length} frames analyzed.`,
    }
  } finally {
    client.close()
  }
}

async function synthesize(
  contract: NvidiaHostedTaskModelContract,
  descriptor: GrpcDescriptor,
  request: NvidiaGrpcRequest,
  options: NvidiaGrpcOptions,
): Promise<NvidiaGrpcResult> {
  const prompt = request.prompt?.trim()
  if (!prompt) throw new Error('prompt is required for NVIDIA Magpie TTS.')
  const referencePath = request.referenceAudioPath ?? request.audioPath ?? request.inputPath
  const reference = referencePath ? await bytes(referencePath, options.cwd) : undefined
  const payload = request.payload ?? {}
  const sampleRate =
    typeof payload.sample_rate_hz === 'number' ? payload.sample_rate_hz : 22_050
  const client = await clientFor(contract, descriptor)
  try {
    const method = client[descriptor.method]
    if (typeof method !== 'function') {
      throw new Error(`NVIDIA gRPC method ${descriptor.method} is unavailable.`)
    }
    const response = await new Promise<JsonObject>((resolveCall, rejectCall) => {
      let abort: (() => void) | undefined
      const call = method.call(
        client,
        {
          text: prompt,
          languageCode:
            typeof payload.language_code === 'string'
              ? payload.language_code
              : 'en-US',
          encoding: 'LINEAR_PCM',
          sampleRateHz: sampleRate,
          voiceName:
            typeof payload.voice_name === 'string'
              ? payload.voice_name
              : reference
                ? 'Magpie-ZeroShot-Multilingual'
                : 'Magpie-ZeroShot-Multilingual.Female',
          ...(reference
            ? {
                zeroShotData: {
                  audioPrompt: reference,
                  sampleRateHz: sampleRate,
                  encoding: 'LINEAR_PCM',
                  quality:
                    typeof payload.quality === 'number' ? payload.quality : 20,
                  ...(typeof payload.transcript === 'string'
                    ? { transcript: payload.transcript }
                    : {}),
                },
              }
            : {}),
        },
        metadata(contract, options.apiKey),
        (error: grpc.ServiceError | null, value: JsonObject) => {
          if (abort) options.signal?.removeEventListener('abort', abort)
          if (error) rejectCall(error)
          else resolveCall(value)
        },
      ) as grpc.ClientUnaryCall
      abort = () => call.cancel()
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort', abort, { once: true })
    })
    const audio = Buffer.isBuffer(response.audio) ? response.audio : Buffer.alloc(0)
    if (audio.length === 0) throw new Error('NVIDIA Magpie returned no audio bytes.')
    const wav = audio.subarray(0, 4).toString() === 'RIFF'
      ? audio
      : wavFromPcm(audio, sampleRate)
    return {
      outputPath: await save(wav, request.outputPath, '.wav', contract, options),
      mediaType: 'audio/wav',
    }
  } finally {
    client.close()
  }
}

export function hasNativeNvidiaGrpcExecutor(model: string): boolean {
  return Boolean(DESCRIPTORS[model.toLowerCase()])
}

export async function runNvidiaGrpcTask(
  contract: NvidiaHostedTaskModelContract,
  request: NvidiaGrpcRequest,
  options: NvidiaGrpcOptions,
): Promise<NvidiaGrpcResult> {
  const descriptor = DESCRIPTORS[contract.id.toLowerCase()]
  if (!descriptor) {
    throw new Error(
      `NVIDIA ${contract.id} publishes a gated streaming endpoint but no public standalone client protocol. Open ${contract.buildCard} and complete NVIDIA's access flow before invoking it. UR kept the model in NVIDIA Special.`,
    )
  }
  if (
    contract.rpcService !== descriptor.service ||
    contract.rpcMethod !== descriptor.method
  ) {
    throw new Error(
      `NVIDIA gRPC catalog mismatch for ${contract.id}: expected ${descriptor.service}/${descriptor.method}.`,
    )
  }
  try {
    if (contract.id === 'nvidia/bnr' || contract.id === 'nvidia/studiovoice') {
      return await audioEnhancement(contract, descriptor, request, options)
    }
    if (contract.id === 'nvidia/synthetic-video-detector') {
      return await syntheticVideo(contract, descriptor, request, options)
    }
    if (contract.id === 'nvidia/active-speaker-detection') {
      return await activeSpeaker(contract, descriptor, request, options)
    }
    if (contract.id === 'nvidia/magpie-tts-zeroshot') {
      return await synthesize(contract, descriptor, request, options)
    }
    throw new Error(`No native NVIDIA gRPC executor is registered for ${contract.id}.`)
  } catch (error) {
    throw grpcError(contract.id, error)
  }
}
