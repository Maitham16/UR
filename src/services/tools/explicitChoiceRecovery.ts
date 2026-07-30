import type { ToolUseBlock } from '@urhq-ai/sdk/resources/index.mjs'
import { isDeepStrictEqual } from 'node:util'
import { findToolByName, type Tools } from '../../Tool.js'
import { normalizeAskQuestionHeaders } from '../../tools/AskUserQuestionTool/normalization.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js'
import type { AssistantMessage } from '../../types/message.js'
import {
  collectExplicitChoiceCandidates,
  type ExplicitChoiceRecoverySource,
} from '../../utils/explicitChoiceRecovery.js'

export interface RecoveredExplicitChoiceToolUse {
  assistantMessage: AssistantMessage
  source: ExplicitChoiceRecoverySource
  toolUse: ToolUseBlock
}

export function recoverExplicitChoiceToolUse({
  assistantMessages,
  tools,
  agentId,
  isNonInteractiveSession,
  uuid,
}: {
  assistantMessages: AssistantMessage[]
  tools: Tools
  agentId?: string
  isNonInteractiveSession: boolean
  uuid: () => string
}): RecoveredExplicitChoiceToolUse | null {
  if (
    assistantMessages.length === 0 ||
    agentId !== undefined ||
    isNonInteractiveSession ||
    assistantMessages.some(
      message => {
        const content = message.message?.content
        return (
          message.isApiErrorMessage ||
          (Array.isArray(content) &&
            content.some(
              (block: { type?: string }) => block.type === 'tool_use',
            ))
        )
      },
    )
  ) {
    return null
  }

  const sourceMessage = assistantMessages.at(-1)
  if (
    !sourceMessage?.message ||
    sourceMessage.message.stop_reason !== 'end_turn'
  ) {
    return null
  }

  const askTool = findToolByName(tools, ASK_USER_QUESTION_TOOL_NAME)
  if (!askTool) return null
  try {
    if (!askTool.isEnabled()) return null
  } catch {
    return null
  }

  const thinkingBlocks: string[] = []
  const textBlocks: string[] = []
  for (const assistantMessage of assistantMessages) {
    const content = assistantMessage.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        thinkingBlocks.push(block.thinking)
      } else if (block.type === 'text' && typeof block.text === 'string') {
        textBlocks.push(block.text)
      }
    }
  }

  for (const candidate of collectExplicitChoiceCandidates({
    thinkingBlocks,
    textBlocks,
  })) {
    const headerNormalizedInput = normalizeAskQuestionHeaders(candidate.input)
    const parsed = askTool.inputSchema.safeParse(headerNormalizedInput)
    if (
      !parsed.success ||
      !isDeepStrictEqual(parsed.data, headerNormalizedInput)
    ) {
      continue
    }

    const idSuffix = uuid().replace(/[^A-Za-z0-9]/g, '')
    const toolUse = {
      type: 'tool_use' as const,
      id: `toolu_recovered_${idSuffix}`,
      name: ASK_USER_QUESTION_TOOL_NAME,
      input: parsed.data,
    } as ToolUseBlock
    const assistantMessage: AssistantMessage = {
      ...sourceMessage,
      uuid: uuid(),
      message: {
        ...sourceMessage.message,
        content: [toolUse],
        stop_reason: 'tool_use',
      },
    }

    return {
      assistantMessage,
      source: candidate.source,
      toolUse,
    }
  }

  return null
}
