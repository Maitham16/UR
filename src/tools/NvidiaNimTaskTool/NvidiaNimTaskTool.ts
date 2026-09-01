import { z } from 'zod/v4'
import {
  getNvidiaHostedTaskModelContract,
  NVIDIA_HOSTED_CATALOG_REVIEWED_AT,
  NVIDIA_HOSTED_TASK_MODEL_CONTRACTS,
  nvidiaHostedTaskModelIds,
} from '../../services/providers/nvidiaHostedModels.js'
import { runNvidiaHostedTask } from '../../services/providers/nvidiaTaskRuntime.js'
import { getProviderApiKey } from '../../services/providers/providerCredentials.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const NVIDIA_NIM_TASK_TOOL_NAME = 'NvidiaNimTask'

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
    documentation: z.string().optional(),
    required: z.array(z.string()).optional(),
    requestSchema: z.record(z.string(), z.unknown()).optional(),
    outputPath: z.string().optional(),
    mediaType: z.string().optional(),
    text: z.string().optional(),
    seed: z.number().optional(),
    finishReason: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function defaultTaskModel(input: z.infer<InputSchema>): string {
  if (input.query || input.passages) return 'nvidia/llama-nemotron-rerank-1b-v2'
  if (input.image_path && !input.prompt) {
    return 'stabilityai/stable-video-diffusion'
  }
  if (input.image_path) return 'google/paligemma'
  return 'black-forest-labs/flux.1-schnell'
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

export const NvidiaNimTaskTool = buildTool({
  name: NVIDIA_NIM_TASK_TOOL_NAME,
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
    return `Use this tool for NVIDIA hosted models that are useful inside UR but cannot own the ongoing agent loop. The catalog was generated from NVIDIA's official OpenAPI reference (${NVIDIA_HOSTED_CATALOG_REVIEWED_AT}) and contains ${NVIDIA_HOSTED_TASK_MODEL_CONTRACTS.length} executable task contracts across ${[...counts.entries()].map(([kind, count]) => `${kind} (${count})`).join(', ')}. Each contract routes to its documented integrate, AI, health, optimization, or climate endpoint using the configured NVIDIA_API_KEY. If /model selected a task model, omit model. For ordinary text/image/reranking inputs, use the convenience fields. For advanced scientific or structured APIs, call action=describe first, then action=run with payload_json and optional file_inputs. UR uses NVIDIA's Asset API automatically for asset inputs and saves binary or large JSON results under .ur/artifacts/nvidia.`
  },
  renderToolUseMessage(input) {
    return input.action === 'describe'
      ? `Reading NVIDIA contract${input.model ? ` for ${input.model}` : ''}`
      : `Running NVIDIA task${input.model ? ` with ${input.model}` : ''}`
  },
  renderToolResultMessage(output) {
    if (output.requestSchema) return `NVIDIA ${output.taskKind} contract ready`
    return output.outputPath
      ? `NVIDIA ${output.taskKind} complete: ${output.outputPath}`
      : `NVIDIA ${output.taskKind} complete`
  },
  async validateInput(input, context) {
    const model = resolveNvidiaTaskModel(
      input,
      context.getAppState().nvidiaTaskModel,
    )
    if (!getNvidiaHostedTaskModelContract(model)) {
      return {
        result: false,
        message: `No public hosted NVIDIA task contract exists for "${model}". Refresh /model; UR currently has ${nvidiaHostedTaskModelIds().length} generated task contracts.`,
        errorCode: 1,
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
          documentation: contract.documentation,
          required: requiredFields(contract.requestSchema),
          requestSchema: contract.requestSchema,
        },
      }
    }
    const apiKey = getProviderApiKey('nvidia-nim') ?? ''
    const data = await runNvidiaHostedTask(
      {
        model,
        prompt: input.prompt,
        imagePath: input.image_path,
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
        ? `NVIDIA ${output.model} is a ${output.taskKind} contract: ${output.purpose}\nEndpoint: ${output.endpoint}\nRequired: ${output.required?.join(', ') || 'none'}\nSchema: ${JSON.stringify(output.requestSchema)}\nDocumentation: ${output.documentation}`
        : output.outputPath
          ? `NVIDIA ${output.taskKind} completed with ${output.model}. Artifact saved to ${output.outputPath}${output.seed !== undefined ? ` (seed ${output.seed})` : ''}.${output.text ? `\n${output.text}` : ''}`
          : `NVIDIA ${output.taskKind} completed with ${output.model}.\n${output.text ?? ''}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
