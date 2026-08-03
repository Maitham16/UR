import type { ToolUseBlock } from '@urhq-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { all } from '../../utils/generators.js'
import { type MessageUpdateLazy, runToolUse } from './toolExecution.js'

const DEFAULT_MAX_TOOL_USE_CONCURRENCY = 10
const HARD_MAX_TOOL_USE_CONCURRENCY = 32

/**
 * How many concurrency-safe tools may run at once.
 *
 * Both executors — the batched orchestrator here and StreamingToolExecutor —
 * ask this one function, because they answer the same user-visible question.
 * They previously carried separate constants and separate environment
 * variables, so tuning parallelism worked or silently did nothing depending on
 * which executor happened to be active. UR_MAX_CONCURRENT_TOOLS is honoured as
 * an alias so existing setups keep working.
 */
export function getMaxToolUseConcurrency(): number {
  for (const raw of [
    process.env.UR_CODE_MAX_TOOL_USE_CONCURRENCY,
    process.env.UR_MAX_CONCURRENT_TOOLS,
  ]) {
    const configured = Number.parseInt(raw ?? '', 10)
    if (Number.isFinite(configured) && configured >= 1) {
      return Math.min(configured, HARD_MAX_TOOL_USE_CONCURRENCY)
    }
  }
  return DEFAULT_MAX_TOOL_USE_CONCURRENCY
}

export type MessageUpdate = {
  message?: Message
  newContext: ToolUseContext
}

function assistantMessageContainsToolUse(
  message: AssistantMessage,
  toolUseId: string,
): boolean {
  const content = message.message?.content
  if (!Array.isArray(content)) return false
  return content.some(
    (block: unknown) =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      block.type === 'tool_use' &&
      'id' in block &&
      block.id === toolUseId,
  )
}

function validateToolUseBatch(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
): void {
  const ids = new Set<string>()
  for (const toolUse of toolUseMessages) {
    if (ids.has(toolUse.id)) {
      throw new Error(`Duplicate tool_use id received: ${toolUse.id}`)
    }
    ids.add(toolUse.id)
    const matches = assistantMessages.filter(message =>
      assistantMessageContainsToolUse(message, toolUse.id),
    )
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one assistant message for tool_use ${toolUse.id}; ` +
          `found ${matches.length}`,
      )
    }
  }
}

function assistantMessageForToolUse(
  toolUse: ToolUseBlock,
  assistantMessages: AssistantMessage[],
): AssistantMessage {
  return assistantMessages.find(message =>
    assistantMessageContainsToolUse(message, toolUse.id),
  )!
}

export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  // Validate the entire batch before starting the first mutation. Duplicate
  // IDs make result correlation and in-progress Set bookkeeping ambiguous.
  validateToolUseBatch(toolUseMessages, assistantMessages)
  let currentContext = toolUseContext
  for (const { isConcurrencySafe, blocks } of partitionToolCalls(
    toolUseMessages,
    currentContext,
  )) {
    if (isConcurrencySafe) {
      const queuedContextModifiers: Record<
        string,
        ((context: ToolUseContext) => ToolUseContext)[]
      > = {}
      // Run read-only batch concurrently
      for await (const update of runToolsConcurrently(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
        if (update.contextModifier) {
          const { toolUseID, modifyContext } = update.contextModifier
          if (!queuedContextModifiers[toolUseID]) {
            queuedContextModifiers[toolUseID] = []
          }
          queuedContextModifiers[toolUseID].push(modifyContext)
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
      for (const block of blocks) {
        const modifiers = queuedContextModifiers[block.id]
        if (!modifiers) {
          continue
        }
        for (const modifier of modifiers) {
          currentContext = modifier(currentContext)
        }
      }
      yield { newContext: currentContext }
    } else {
      // Run non-read-only batch serially
      for await (const update of runToolsSerially(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
        if (update.newContext) {
          currentContext = update.newContext
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
    }
  }
}

type Batch = { isConcurrencySafe: boolean; blocks: ToolUseBlock[] }

/**
 * Partition tool calls into batches where each batch is either:
 * 1. A single non-read-only tool, or
 * 2. Multiple consecutive read-only tools
 */
function partitionToolCalls(
  toolUseMessages: ToolUseBlock[],
  toolUseContext: ToolUseContext,
): Batch[] {
  return toolUseMessages.reduce((acc: Batch[], toolUse) => {
    const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
    const parsedInput = tool?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(tool?.isConcurrencySafe(parsedInput.data))
          } catch {
            // If isConcurrencySafe throws (e.g., due to shell-quote parse failure),
            // treat as not concurrency-safe to be conservative
            return false
          }
        })()
      : false
    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }
    return acc
  }, [])
}

async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const toolUse of toolUseMessages) {
    toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(toolUse.id),
    )
    try {
      for await (const update of runToolUse(
        toolUse,
        assistantMessageForToolUse(toolUse, assistantMessages),
        canUseTool,
        currentContext,
      )) {
        if (update.contextModifier) {
          currentContext = update.contextModifier.modifyContext(currentContext)
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
    } finally {
      // Async-generator consumers may stop early (abort, fallback, teardown).
      // Always clear UI/runtime bookkeeping even when iteration is cancelled
      // or an invariant error escapes runToolUse.
      markToolUseAsComplete(toolUseContext, toolUse.id)
    }
  }
}

async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  try {
    yield* all(
      toolUseMessages.map(async function* (toolUse) {
        toolUseContext.setInProgressToolUseIDs(prev =>
          new Set(prev).add(toolUse.id),
        )
        try {
          yield* runToolUse(
            toolUse,
            assistantMessageForToolUse(toolUse, assistantMessages),
            canUseTool,
            toolUseContext,
          )
        } finally {
          markToolUseAsComplete(toolUseContext, toolUse.id)
        }
      }),
      getMaxToolUseConcurrency(),
    )
  } finally {
    // The generic all() multiplexer can still have child generators awaiting
    // their next value when its consumer cancels. Clear every batch member
    // here as a final guard; deleting an ID that never started is harmless.
    for (const toolUse of toolUseMessages) {
      markToolUseAsComplete(toolUseContext, toolUse.id)
    }
  }
}

function markToolUseAsComplete(
  toolUseContext: ToolUseContext,
  toolUseID: string,
) {
  toolUseContext.setInProgressToolUseIDs(prev => {
    const next = new Set(prev)
    next.delete(toolUseID)
    return next
  })
}
