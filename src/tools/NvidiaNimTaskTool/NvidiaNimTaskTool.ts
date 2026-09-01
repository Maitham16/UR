import { z } from 'zod/v4'
import {
  getNvidiaHostedTaskModelContract,
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
    model: z
      .string()
      .optional()
      .describe(
        `Exact NVIDIA one-shot model ID. Available adapters: ${nvidiaHostedTaskModelIds().join(', ')}. Omit it to use the task model selected in /model, or the matching built-in default.`,
      ),
    prompt: z
      .string()
      .optional()
      .describe(
        'Required for text-to-image and image-understanding tasks. Describe the image to generate or the question to answer about the input image.',
      ),
    image_path: z
      .string()
      .optional()
      .describe(
        'Local JPEG or PNG path required for image-to-video and image-understanding tasks.',
      ),
    output_path: z
      .string()
      .optional()
      .describe(
        'Optional output path for generated image/video. Relative paths resolve from the current working directory; otherwise UR writes under .ur/artifacts/nvidia/.',
      ),
    width: z.number().int().optional().describe('FLUX output width.'),
    height: z.number().int().optional().describe('FLUX output height.'),
    steps: z.number().int().min(1).max(4).optional().describe('FLUX diffusion steps (1-4).'),
    seed: z.number().int().min(0).optional().describe('Generation seed; 0 asks NVIDIA for a random seed.'),
    cfg_scale: z.number().optional().describe('Stable Video Diffusion source-image adherence (>1 through 9).'),
    max_tokens: z.number().int().min(1).max(1024).optional().describe('Maximum PaliGemma analysis tokens.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    model: z.string(),
    taskKind: z.enum(['text-to-image', 'image-to-video', 'image-understanding']),
    purpose: z.string(),
    outputPath: z.string().optional(),
    mediaType: z.string().optional(),
    text: z.string().optional(),
    seed: z.number().optional(),
    finishReason: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export function resolveNvidiaTaskModel(
  input: z.infer<InputSchema>,
  selectedModel: string | undefined,
): string {
  if (input.model?.trim()) return input.model.trim()
  if (selectedModel && getNvidiaHostedTaskModelContract(selectedModel)) {
    return selectedModel
  }
  if (input.image_path && !input.prompt) {
    return 'stabilityai/stable-video-diffusion'
  }
  if (input.image_path) return 'google/paligemma'
  return 'black-forest-labs/flux.1-schnell'
}

export const NvidiaNimTaskTool = buildTool({
  name: NVIDIA_NIM_TASK_TOOL_NAME,
  searchHint: 'generate images videos or analyze pictures with NVIDIA',
  maxResultSizeChars: 30_000,
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
    const contract = input.model
      ? getNvidiaHostedTaskModelContract(input.model)
      : undefined
    return contract?.taskKind === 'image-understanding'
  },
  async description(input) {
    const contract = input.model
      ? getNvidiaHostedTaskModelContract(input.model)
      : undefined
    return contract
      ? `Run NVIDIA ${contract.displayName} once: ${contract.purpose}`
      : 'Run a verified one-shot NVIDIA image, video, or visual-understanding model without changing the ongoing agent model.'
  },
  async prompt() {
    return `Use this tool for NVIDIA's specialized hosted models, never as the ongoing chat model. It uses the same securely configured NVIDIA_API_KEY as the NVIDIA NIM provider and dispatches each model to its documented endpoint. Supported adapters:\n${nvidiaHostedTaskModelIds()
      .map(id => {
        const contract = getNvidiaHostedTaskModelContract(id)!
        return `- ${id} (${contract.taskKind}): ${contract.purpose}`
      })
      .join('\n')}\nIf the user selected a one-shot NVIDIA model in /model, omit model to use that preference. Return the generated file path or analysis text to the user. Do not place generated image bytes in tool_result content.`
  },
  renderToolUseMessage(input) {
    return `Running NVIDIA one-shot task${input.model ? ` with ${input.model}` : ''}`
  },
  renderToolResultMessage(output) {
    return output.outputPath
      ? `NVIDIA ${output.taskKind} complete: ${output.outputPath}`
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
        message: `No implemented NVIDIA one-shot adapter for "${model}". Available: ${nvidiaHostedTaskModelIds().join(', ')}.`,
        errorCode: 1,
      }
    }
    if (contract.taskKind === 'text-to-image' && !input.prompt?.trim()) {
      return { result: false, message: 'prompt is required for text-to-image.', errorCode: 2 }
    }
    if (contract.taskKind !== 'text-to-image' && !input.image_path?.trim()) {
      return { result: false, message: `image_path is required for ${contract.taskKind}.`, errorCode: 3 }
    }
    if (contract.taskKind === 'image-understanding' && !input.prompt?.trim()) {
      return { result: false, message: 'prompt is required for image-understanding.', errorCode: 4 }
    }
    return { result: true }
  },
  async call(input, context) {
    const model = resolveNvidiaTaskModel(
      input,
      context.getAppState().nvidiaTaskModel,
    )
    const apiKey = getProviderApiKey('nvidia-nim') ?? ''
    const data = await runNvidiaHostedTask(
      {
        model,
        prompt: input.prompt,
        imagePath: input.image_path,
        outputPath: input.output_path,
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
      content: output.outputPath
        ? `NVIDIA ${output.taskKind} completed with ${output.model}. Artifact saved to ${output.outputPath}${output.seed !== undefined ? ` (seed ${output.seed})` : ''}.`
        : `NVIDIA ${output.taskKind} completed with ${output.model}.\n${output.text ?? ''}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
