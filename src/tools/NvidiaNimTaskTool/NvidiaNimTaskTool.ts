import { z } from 'zod/v4'
import {
  getNvidiaHostedTaskModelContract,
  NVIDIA_BUILD_EXECUTABLE_ENDPOINT_COUNT,
  NVIDIA_BUILD_FREE_ENDPOINT_COUNT,
  NVIDIA_BUILD_INDEX_MODEL_COUNT,
  NVIDIA_HOSTED_CATALOG_REVIEWED_AT,
  NVIDIA_HOSTED_TASK_MODEL_CONTRACTS,
  nvidiaHostedTaskModelIds,
} from '../../services/providers/nvidiaHostedModels.js'
import { runNvidiaHostedTask } from '../../services/providers/nvidiaTaskRuntime.js'
import { getProviderApiKey } from '../../services/providers/providerCredentials.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const NVIDIA_SPECIAL_TOOL_NAME = 'NvidiaSpecial'
/** @deprecated Compatibility export for SDK consumers; the tool is NvidiaSpecial. */
export const NVIDIA_NIM_TASK_TOOL_NAME = NVIDIA_SPECIAL_TOOL_NAME

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['run', 'describe'])
      .optional()
      .describe(
        'Use describe to retrieve the selected model’s exact NVIDIA request schema; use run to invoke it.',
      ),
    model: z
      .string()
      .optional()
      .describe(
        'Exact NVIDIA task model ID. Omit it to use the task selected in /model or UR’s matching default.',
      ),
    prompt: z
      .string()
      .optional()
      .describe(
        'Convenience text input for chat, generation, image understanding, biology, and other single-text-field contracts.',
      ),
    image_path: z
      .string()
      .optional()
      .describe(
        'Convenience local image path. UR inlines files below NVIDIA’s limit and uploads larger inputs through NVIDIA’s Asset API.',
      ),
    input_path: z
      .string()
      .optional()
      .describe('Primary local media/file input for the selected NVIDIA Special model.'),
    audio_path: z
      .string()
      .optional()
      .describe('Local WAV/MP3/Opus audio input for NVIDIA speech and audio models.'),
    video_path: z
      .string()
      .optional()
      .describe('Local MP4 video input for NVIDIA video analysis models.'),
    reference_audio_path: z
      .string()
      .optional()
      .describe('Three-to-ten-second reference WAV used by NVIDIA zero-shot TTS.'),
    diarization_path: z
      .string()
      .optional()
      .describe('Optional NVIDIA active-speaker diarization JSON input.'),
    output_path: z
      .string()
      .optional()
      .describe(
        'Optional artifact/JSON output path; relative paths resolve from the current working directory.',
      ),
    query: z.string().optional().describe('Convenience query for reranking models.'),
    passages: z
      .array(z.string())
      .optional()
      .describe('Convenience candidate passages for reranking models.'),
    payload_json: z
      .string()
      .optional()
      .describe(
        'Exact JSON request object for advanced NVIDIA contracts. Convenience fields fill only missing properties.',
      ),
    file_inputs: z
      .array(
        z.strictObject({
          json_pointer: z
            .string()
            .describe('RFC 6901-style pointer where the encoded file value is inserted.'),
          path: z.string().describe('Local file path.'),
          encoding: z
            .enum(['data-url', 'base64', 'text', 'asset-id', 'asset-reference'])
            .optional()
            .describe(
              'Use asset-id for UUID fields or asset-reference for NVIDIA data:*;asset_id references.',
            ),
        }),
      )
      .optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    steps: z.number().int().positive().optional(),
    seed: z.number().int().min(0).optional(),
    cfg_scale: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    model: z.string(),
    taskKind: z.string(),
    purpose: z.string(),
    endpoint: z.string().optional(),
    transport: z.string().optional(),
    method: z.string().optional(),
    functionId: z.string().optional(),
    rpcService: z.string().optional(),
    rpcMethod: z.string().optional(),
    documentation: z.string().optional(),
    available: z.boolean().optional(),
    executable: z.boolean().optional(),
    inputHint: z.string().optional(),
    outputHint: z.string().optional(),
    required: z.array(z.string()).optional(),
    requestSchema: z.record(z.string(), z.unknown()).optional(),
    responseSchema: z.record(z.string(), z.unknown()).optional(),
    outputPath: z.string().optional(),
    mediaType: z.string().optional(),
    text: z.string().optional(),
    seed: z.number().optional(),
    finishReason: z.string().optional(),
    artifacts: z
      .array(
        z.object({
          label: z.string(),
          path: z.string(),
          mediaType: z.string(),
        }),
      )
      .optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function defaultTaskModel(input: z.infer<InputSchema>): string {
  if (input.video_path) return 'nvidia/synthetic-video-detector'
  if (input.audio_path) return 'nvidia/bnr'
  if (input.image_path) return 'google/paligemma'
  if (input.query || input.passages) return 'nvidia/nemotron-3-embed-1b'
  return 'google/diffusiongemma-26b-a4b-it'
}

export function resolveNvidiaTaskModel(
  input: z.infer<InputSchema>,
  selectedModel: string | undefined,
): string {
  if (input.model?.trim()) return input.model.trim()
  if (selectedModel && getNvidiaHostedTaskModelContract(selectedModel)) {
    return selectedModel
  }
  return defaultTaskModel(input)
}

function parsePayload(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(
      `payload_json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('payload_json must contain a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function requiredFields(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === 'string')
    : []
}

export const NvidiaSpecialTool = buildTool({
  name: NVIDIA_SPECIAL_TOOL_NAME,
  searchHint:
    'NVIDIA hosted image video vision embedding reranking biology climate route or specialized inference',
  maxResultSizeChars: 120_000,
  strict: true,
  shouldDefer: true,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly(input) {
    if (input.action === 'describe') return true
    const contract = input.model
      ? getNvidiaHostedTaskModelContract(input.model)
      : undefined
    return !contract?.outputExtension
  },
  async description(input) {
    const contract = input.model
      ? getNvidiaHostedTaskModelContract(input.model)
      : undefined
    return contract
      ? `${input.action === 'describe' ? 'Describe' : 'Run'} NVIDIA ${contract.displayName}: ${contract.purpose}`
      : `${input.action === 'describe' ? 'Describe' : 'Run'} a documented NVIDIA hosted task model.`
  },
  async prompt() {
    const counts = new Map<string, number>()
    for (const contract of NVIDIA_HOSTED_TASK_MODEL_CONTRACTS) {
      counts.set(contract.taskKind, (counts.get(contract.taskKind) ?? 0) + 1)
    }
    const executableTasks = NVIDIA_HOSTED_TASK_MODEL_CONTRACTS.filter(
      contract => contract.executable,
    ).length
    return `Use this tool for NVIDIA Special models that perform a focused task without owning UR's ongoing agent loop. UR audited ${NVIDIA_BUILD_INDEX_MODEL_COUNT} current build.nvidia.com cards and preserved all ${NVIDIA_BUILD_FREE_ENDPOINT_COUNT} Free Endpoint entries across NVIDIA Agentic and NVIDIA Special; ${NVIDIA_BUILD_EXECUTABLE_ENDPOINT_COUNT} publish an executable inference contract. NVIDIA Special contains ${NVIDIA_HOSTED_TASK_MODEL_CONTRACTS.length} entries (${executableTasks} executable) across ${[...counts.entries()].map(([kind, count]) => `${kind} (${count})`).join(', ')}. Every HTTP model uses the exact URL, method, request schema, and response schema embedded in its own NVIDIA card. NVIDIA Maxine and Riva models use their documented RPC service, RPC method, grpc.nvcf.nvidia.com transport, and card-specific function ID. UR keeps unpublished or account-disabled entries visible and never invents a transport. The catalog was reviewed at ${NVIDIA_HOSTED_CATALOG_REVIEWED_AT}. If /model selected an NVIDIA Special model, omit model. Call action=describe when you need the precise contract; use the convenience media fields or payload_json/file_inputs to run it. Artifacts are saved under .ur/artifacts/nvidia unless output_path is supplied.`
  },
  renderToolUseMessage(input) {
    return input.action === 'describe'
      ? `Reading NVIDIA contract${input.model ? ` for ${input.model}` : ''}`
      : `Running NVIDIA Special${input.model ? ` with ${input.model}` : ''}`
  },
  renderToolResultMessage(output) {
    if (output.requestSchema) return `NVIDIA ${output.taskKind} contract ready`
    return output.outputPath
      ? `NVIDIA ${output.taskKind} complete: ${output.artifacts?.length ?? 1} artifact${(output.artifacts?.length ?? 1) === 1 ? '' : 's'}`
      : `NVIDIA ${output.taskKind} complete`
  },
  async validateInput(input, context) {
    const model = resolveNvidiaTaskModel(
      input,
      context.getAppState().nvidiaTaskModel,
    )
    const contract = getNvidiaHostedTaskModelContract(model)
    if (!contract) {
      return {
        result: false,
        message: `No public hosted NVIDIA task contract exists for "${model}". Refresh /model; UR currently has ${nvidiaHostedTaskModelIds().length} generated task contracts.`,
        errorCode: 1,
      }
    }
    if (input.action !== 'describe' && !contract.executable) {
      return {
        result: false,
        message: `NVIDIA keeps ${model} in its Free Endpoint catalog but has not published an inference protocol for it. UR keeps it visible and will not guess a request contract. See ${contract.documentation}`,
        errorCode: 3,
      }
    }
    try {
      parsePayload(input.payload_json)
    } catch (error) {
      return {
        result: false,
        message: error instanceof Error ? error.message : String(error),
        errorCode: 2,
      }
    }
    return { result: true }
  },
  async call(input, context) {
    const model = resolveNvidiaTaskModel(
      input,
      context.getAppState().nvidiaTaskModel,
    )
    const contract = getNvidiaHostedTaskModelContract(model)!
    if (input.action === 'describe') {
      return {
        data: {
          model: contract.id,
          taskKind: contract.taskKind,
          purpose: contract.purpose,
          endpoint: contract.endpoint,
          transport: contract.transport,
          method: contract.method,
          functionId: contract.functionId,
          rpcService: contract.rpcService,
          rpcMethod: contract.rpcMethod,
          documentation: contract.documentation,
          available: contract.available,
          executable: contract.executable,
          inputHint: contract.inputHint,
          outputHint: contract.outputHint,
          required: requiredFields(contract.requestSchema),
          requestSchema: contract.requestSchema,
          responseSchema: contract.responseSchema,
        },
      }
    }
    const apiKey = getProviderApiKey('nvidia-special') ?? ''
    const data = await runNvidiaHostedTask(
      {
        model,
        prompt: input.prompt,
        imagePath: input.image_path,
        inputPath: input.input_path,
        audioPath: input.audio_path,
        videoPath: input.video_path,
        referenceAudioPath: input.reference_audio_path,
        diarizationPath: input.diarization_path,
        outputPath: input.output_path,
        query: input.query,
        passages: input.passages,
        payload: parsePayload(input.payload_json),
        fileInputs: input.file_inputs?.map(file => ({
          jsonPointer: file.json_pointer,
          path: file.path,
          encoding: file.encoding,
        })),
        width: input.width,
        height: input.height,
        steps: input.steps,
        seed: input.seed,
        cfgScale: input.cfg_scale,
        maxTokens: input.max_tokens,
      },
      {
        apiKey,
        cwd: getCwd(),
        signal: context.abortController.signal,
      },
    )
    return { data }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output.requestSchema
        ? `NVIDIA ${output.model} is a ${output.taskKind} contract: ${output.purpose}\nCatalog status: ${output.available ? 'available' : 'currently marked unavailable by NVIDIA'} · ${output.executable ? 'public inference contract' : 'inference protocol unpublished'}\nTransport: ${output.transport} ${output.method}${output.rpcService ? `\nRPC: ${output.rpcService}/${output.rpcMethod}` : ''}\nEndpoint: ${output.endpoint}${output.functionId ? `\nFunction ID: ${output.functionId}` : ''}\nInput: ${output.inputHint}\nOutput: ${output.outputHint}\nRequired: ${output.required?.join(', ') || 'none'}\nRequest schema: ${JSON.stringify(output.requestSchema)}\nResponse schema: ${JSON.stringify(output.responseSchema)}\nDocumentation: ${output.documentation}`
        : output.outputPath
          ? `NVIDIA ${output.taskKind} completed with ${output.model}. ${output.artifacts?.length ? `Artifacts:\n${output.artifacts.map(artifact => `- ${artifact.label}: ${artifact.path} (${artifact.mediaType})`).join('\n')}` : `Artifact saved to ${output.outputPath}`}${output.seed !== undefined ? ` (seed ${output.seed})` : ''}.${output.text ? `\n${output.text}` : ''}`
          : `NVIDIA ${output.taskKind} completed with ${output.model}.\n${output.text ?? ''}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

/** @deprecated Use NvidiaSpecialTool. */
export const NvidiaNimTaskTool = NvidiaSpecialTool
