import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getGlobalConfig } from '../../utils/config.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    message: z
      .string()
      .min(1)
      .describe('Concise notification text shown outside the active terminal.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    delivered: z.boolean(),
    message: z.string(),
    sentAt: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type PushNotificationOutput = z.infer<OutputSchema>

export const PushNotificationTool = buildTool({
  name: 'PushNotification',
  searchHint: 'notify the user outside the terminal',
  maxResultSizeChars: 10_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return getGlobalConfig().agentPushNotifEnabled === true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async description() {
    return 'Send an opt-in OS or terminal notification to the user'
  },
  async prompt() {
    return 'Notify the user about an important proactive update when they may not be watching the terminal. Use sparingly and keep the message concise.'
  },
  renderToolUseMessage({ message }) {
    return message ? `Notifying: ${message}` : 'Notifying user'
  },
  renderToolResultMessage(output) {
    return output.delivered ? 'Notification sent' : 'Notification unavailable'
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output.delivered
        ? 'Notification sent.'
        : 'No notification transport is available in this session.',
    }
  },
  async call({ message }, context) {
    const delivered = context.sendOSNotification !== undefined
    context.sendOSNotification?.({
      message,
      notificationType: 'agent_push',
    })
    return {
      data: {
        delivered,
        message,
        sentAt: new Date().toISOString(),
      },
    }
  },
} satisfies ToolDef<InputSchema, PushNotificationOutput>)
