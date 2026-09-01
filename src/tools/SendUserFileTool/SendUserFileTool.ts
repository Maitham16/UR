import { z } from 'zod/v4'
import { getKairosActive } from '../../bootstrap/state.js'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  resolveAttachments,
  validateAttachmentPaths,
} from '../BriefTool/attachments.js'
import {
  renderToolResultMessage as renderBriefResult,
  renderToolUseMessage as renderBriefUse,
} from '../BriefTool/UI.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  DESCRIPTION,
  PROMPT,
  SEND_USER_FILE_TOOL_NAME,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    files: z
      .array(z.string())
      .min(1)
      .describe('Local file paths to deliver to the user.'),
    caption: z
      .string()
      .optional()
      .describe('Optional short context shown with the files.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const resolvedFileSchema = z.object({
  path: z.string(),
  size: z.number().nonnegative(),
  isImage: z.boolean(),
  file_uuid: z.string().optional(),
})
const outputSchema = lazySchema(() =>
  z.object({
    files: z.array(resolvedFileSchema),
    caption: z.string().optional(),
    sentAt: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type SendUserFileOutput = z.infer<OutputSchema>

export const SendUserFileTool = buildTool({
  name: SEND_USER_FILE_TOOL_NAME,
  searchHint: 'deliver local artifacts and attachments',
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return getKairosActive()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  userFacingName() {
    return ''
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  async validateInput({ files }): Promise<ValidationResult> {
    return validateAttachmentPaths(files)
  },
  renderToolUseMessage: renderBriefUse,
  renderToolResultMessage(output, progress, options) {
    return renderBriefResult(
      {
        message: output.caption ?? '',
        attachments: output.files,
        sentAt: output.sentAt,
      },
      progress,
      options,
    )
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `Delivered ${output.files.length} file${output.files.length === 1 ? '' : 's'} to the user.`,
    }
  },
  async call({ files, caption }, context) {
    const resolved = await resolveAttachments(files, {
      replBridgeEnabled: context.getAppState().replBridgeEnabled,
      signal: context.abortController.signal,
    })
    return {
      data: {
        files: resolved,
        ...(caption ? { caption } : {}),
        sentAt: new Date().toISOString(),
      },
    }
  },
} satisfies ToolDef<InputSchema, SendUserFileOutput>)
