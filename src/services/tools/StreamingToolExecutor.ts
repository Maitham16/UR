import type { ToolUseBlock } from '@urhq-ai/sdk/resources/index.mjs'
import {
  createUserMessage,
  REJECT_MESSAGE,
  withMemoryCorrectionHint,
} from 'src/utils/messages.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type Tools, type ToolUseContext } from '../../Tool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { createChildAbortController } from '../../utils/abortController.js'
import { runToolUse } from './toolExecution.js'

type MessageUpdate = {
  message?: Message
  newContext?: ToolUseContext
}

type RunToolUse = typeof runToolUse

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

// Default cap on concurrently-executing read-safe tools. Matches the
// "up to 8 parallel calls" guidance in the system prompt. Configurable
// via UR_MAX_CONCURRENT_TOOLS.
const MAX_CONCURRENT_TOOLS = 8

type TrackedTool = {
  id: string
  block: ToolUseBlock
  assistantMessage: AssistantMessage
  status: ToolStatus
  isConcurrencySafe: boolean
  promise?: Promise<void>
  results?: Message[]
  // Progress messages are stored separately and yielded immediately
  pendingProgress: Message[]
  contextModifiers?: Array<(context: ToolUseContext) => ToolUseContext>
}

/**
 * Executes tools as they stream in with concurrency control.
 * - Concurrent-safe tools can execute in parallel with other concurrent-safe tools
 * - Non-concurrent tools must execute alone (exclusive access)
 * - Results are buffered and emitted in the order tools were received
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private hasErrored = false
  private erroredToolDescription = ''
  // Child of toolUseContext.abortController. Fires when a Bash tool errors
  // so sibling subprocesses die immediately instead of running to completion.
  // Aborting this does NOT abort the parent — query.ts won't end the turn.
  private siblingAbortController: AbortController
  private discarded = false
  // Signal to wake up getRemainingResults when progress is available
  private progressAvailableResolve?: () => void

  constructor(
    private readonly toolDefinitions: Tools,
    private readonly canUseTool: CanUseToolFn,
    toolUseContext: ToolUseContext,
    private readonly runToolUseFn: RunToolUse = runToolUse,
  ) {
    this.toolUseContext = toolUseContext
    this.siblingAbortController = createChildAbortController(
      toolUseContext.abortController,
    )
  }

  /**
   * Discards all pending and in-progress tools. Called when streaming fallback
   * occurs and results from the failed attempt should be abandoned.
   * Queued tools won't start, and in-progress tools are aborted.
   */
  discard(): void {
    if (this.discarded) {
      return
    }

    this.discarded = true

    // Abort the executor-owned controller rather than the query controller:
    // fallback should stop abandoned tools without ending the replacement
    // attempt. Per-tool child controllers inherit this abort.
    if (!this.siblingAbortController.signal.aborted) {
      this.siblingAbortController.abort('streaming_fallback')
    }

    for (const tool of this.tools) {
      tool.pendingProgress.length = 0

      // Queued tools were never registered as in progress and must never start.
      if (tool.status === 'queued') {
        tool.status = 'yielded'
        continue
      }

      // Completed and executing results are intentionally not yielded after a
      // fallback, so clear their UI bookkeeping here instead.
      if (tool.status !== 'yielded') {
        markToolUseAsComplete(this.toolUseContext, tool.id)
      }
    }

    this.toolUseContext.setHasInterruptibleToolInProgress?.(false)

    // A caller may already be blocked in getRemainingResults(). Wake it so the
    // discarded attempt can settle even if a tool ignores its abort signal.
    this.progressAvailableResolve?.()
    this.progressAvailableResolve = undefined
  }

  /**
   * Add a tool to the execution queue. Will start executing immediately if conditions allow.
   */
  addTool(block: ToolUseBlock, assistantMessage: AssistantMessage): void {
    if (this.tools.some(tool => tool.id === block.id)) {
      // A Set cannot represent two in-flight calls with the same ID, and tool
      // results would be correlated to the wrong assistant block. Abort the
      // eager batch as soon as the provider violation becomes observable.
      this.discard()
      throw new Error(`Duplicate tool_use id received: ${block.id}`)
    }
    const executionAssistantMessage = this.withObservedBatchToolUses(
      block,
      assistantMessage,
    )
    const toolDefinition = findToolByName(this.toolDefinitions, block.name)
    if (!toolDefinition) {
      // Route unknown tools through runToolUse as well. It owns telemetry and
      // the repeated-failure guard; synthesizing an error here let a weak
      // streaming model repeat the same hallucinated tool forever.
      this.tools.push({
        id: block.id,
        block,
        assistantMessage: executionAssistantMessage,
        status: 'queued',
        isConcurrencySafe: false,
        pendingProgress: [],
      })
      void this.processQueue()
      return
    }

    const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
          } catch {
            return false
          }
        })()
      : false
    this.tools.push({
      id: block.id,
      block,
      assistantMessage: executionAssistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
    })

    void this.processQueue()
  }

  /**
   * Streaming yields one AssistantMessage per completed content block, even
   * when several tool_use blocks belong to the same provider message. Runtime
   * policy needs each call's stable ordinal within that provider message; a
   * one-block snapshot makes every eager call look like ordinal zero.
   *
   * Build an execution-only view containing the same-message tool blocks
   * observed so far. The original message remains untouched for transcript
   * serialization and API round-tripping.
   */
  private withObservedBatchToolUses(
    block: ToolUseBlock,
    assistantMessage: AssistantMessage,
  ): AssistantMessage {
    const message = assistantMessage.message
    if (
      !message ||
      typeof message.id !== 'string' ||
      message.id.length === 0
    ) {
      return assistantMessage
    }
    const messageId = message.id

    const priorBlocks = this.tools
      .filter(tool => tool.assistantMessage.message?.id === messageId)
      .map(tool => tool.block)
    if (priorBlocks.length === 0) {
      return assistantMessage
    }

    const seenToolUseIds = new Set(priorBlocks.map(toolUse => toolUse.id))
    const combinedContent = [...priorBlocks]
    for (const contentBlock of message.content) {
      if (
        contentBlock.type === 'tool_use' &&
        seenToolUseIds.has(contentBlock.id)
      ) {
        continue
      }
      combinedContent.push(contentBlock)
      if (contentBlock.type === 'tool_use') {
        seenToolUseIds.add(contentBlock.id)
      }
    }
    if (!seenToolUseIds.has(block.id)) {
      combinedContent.push(block)
    }

    return {
      ...assistantMessage,
      message: {
        ...message,
        content: combinedContent,
      },
    }
  }

  /**
   * Check if a tool can execute based on current concurrency state.
   *
   * Caps simultaneous concurrent-safe tools to MAX_CONCURRENT_TOOLS so a
   * burst of N parallel reads doesn't exhaust FDs / memory. Override via
   * UR_MAX_CONCURRENT_TOOLS (clamped to [1, 32]).
   */
  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')
    if (executingTools.length === 0) return true
    if (!isConcurrencySafe) return false
    if (!executingTools.every(t => t.isConcurrencySafe)) return false
    const envCap = Number(process.env.UR_MAX_CONCURRENT_TOOLS)
    const cap =
      Number.isFinite(envCap) && envCap >= 1
        ? Math.min(Math.floor(envCap), 32)
        : MAX_CONCURRENT_TOOLS
    return executingTools.length < cap
  }

  /**
   * Process the queue, starting tools when concurrency conditions allow
   */
  private async processQueue(): Promise<void> {
    if (this.discarded) {
      return
    }

    for (const tool of this.tools) {
      if (this.discarded) {
        return
      }
      if (tool.status !== 'queued') continue

      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        await this.executeTool(tool)
      } else {
        // Can't execute this tool yet, and since we need to maintain order for non-concurrent tools, stop here
        if (!tool.isConcurrencySafe) break
      }
    }
  }

  private createSyntheticErrorMessage(
    toolUseId: string,
    reason: 'sibling_error' | 'user_interrupted' | 'streaming_fallback',
    assistantMessage: AssistantMessage,
  ): Message {
    // For user interruptions (ESC to reject), use REJECT_MESSAGE so the UI shows
    // "User rejected edit" instead of "Error editing file"
    if (reason === 'user_interrupted') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: withMemoryCorrectionHint(REJECT_MESSAGE),
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'User rejected tool use',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    if (reason === 'streaming_fallback') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content:
              '<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>',
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'Streaming fallback - tool execution discarded',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    const desc = this.erroredToolDescription
    const msg = desc
      ? `Cancelled: parallel tool call ${desc} errored`
      : 'Cancelled: parallel tool call errored'
    return createUserMessage({
      content: [
        {
          type: 'tool_result',
          content: `<tool_use_error>${msg}</tool_use_error>`,
          is_error: true,
          tool_use_id: toolUseId,
        },
      ],
      toolUseResult: msg,
      sourceToolAssistantUUID: assistantMessage.uuid,
    })
  }

  /**
   * Determine why a tool should be cancelled.
   */
  private getAbortReason(
    tool: TrackedTool,
  ): 'sibling_error' | 'user_interrupted' | 'streaming_fallback' | null {
    if (this.discarded) {
      return 'streaming_fallback'
    }
    if (this.hasErrored) {
      return 'sibling_error'
    }
    if (this.toolUseContext.abortController.signal.aborted) {
      // 'interrupt' means the user typed a new message while tools were
      // running. Only cancel tools whose interruptBehavior is 'cancel';
      // 'block' tools shouldn't reach here (abort isn't fired).
      if (this.toolUseContext.abortController.signal.reason === 'interrupt') {
        return this.getToolInterruptBehavior(tool) === 'cancel'
          ? 'user_interrupted'
          : null
      }
      return 'user_interrupted'
    }
    return null
  }

  private getToolInterruptBehavior(tool: TrackedTool): 'cancel' | 'block' {
    const definition = findToolByName(this.toolDefinitions, tool.block.name)
    if (!definition?.interruptBehavior) return 'block'
    try {
      return definition.interruptBehavior()
    } catch {
      return 'block'
    }
  }

  private getToolDescription(tool: TrackedTool): string {
    const input = tool.block.input as Record<string, unknown> | undefined
    const summary = input?.command ?? input?.file_path ?? input?.pattern ?? ''
    if (typeof summary === 'string' && summary.length > 0) {
      const truncated =
        summary.length > 40 ? summary.slice(0, 40) + '\u2026' : summary
      return `${tool.block.name}(${truncated})`
    }
    return tool.block.name
  }

  private updateInterruptibleState(): void {
    const executing = this.tools.filter(t => t.status === 'executing')
    this.toolUseContext.setHasInterruptibleToolInProgress?.(
      executing.length > 0 &&
        executing.every(t => this.getToolInterruptBehavior(t) === 'cancel'),
    )
  }

  /**
   * Execute a tool and collect its results
   */
  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    this.toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(tool.id),
    )
    this.updateInterruptibleState()

    const messages: Message[] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> =
      []

    const collectResults = async () => {
      // If already aborted (by error or user), generate synthetic error block instead of running the tool
      const initialAbortReason = this.getAbortReason(tool)
      if (initialAbortReason) {
        messages.push(
          this.createSyntheticErrorMessage(
            tool.id,
            initialAbortReason,
            tool.assistantMessage,
          ),
        )
        tool.results = messages
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.updateInterruptibleState()
        return
      }

      // Per-tool child controller. Lets siblingAbortController kill running
      // subprocesses (Bash spawns listen to this signal) when a Bash error
      // cascades. Permission-dialog rejection also aborts this controller
      // (PermissionContext.ts cancelAndAbort) — that abort must bubble up to
      // the query controller so the query loop's post-tool abort check ends
      // the turn. Without bubble-up, ExitPlanMode "clear context + auto"
      // sends REJECT_MESSAGE to the model instead of aborting (#21056 regression).
      const toolAbortController = createChildAbortController(
        this.siblingAbortController,
      )
      toolAbortController.signal.addEventListener(
        'abort',
        () => {
          if (
            toolAbortController.signal.reason !== 'sibling_error' &&
            !this.toolUseContext.abortController.signal.aborted &&
            !this.discarded
          ) {
            this.toolUseContext.abortController.abort(
              toolAbortController.signal.reason,
            )
          }
        },
        { once: true },
      )

      const generator = this.runToolUseFn(
        tool.block,
        tool.assistantMessage,
        this.canUseTool,
        { ...this.toolUseContext, abortController: toolAbortController },
      )

      // Track if this specific tool has produced an error result.
      // This prevents the tool from receiving a duplicate "sibling error"
      // message when it is the one that caused the error.
      let thisToolErrored = false

      for await (const update of generator) {
        // Check if we were aborted by a sibling tool error or user interruption.
        // Only add the synthetic error if THIS tool didn't produce the error.
        const abortReason = this.getAbortReason(tool)
        if (abortReason && !thisToolErrored) {
          messages.push(
            this.createSyntheticErrorMessage(
              tool.id,
              abortReason,
              tool.assistantMessage,
            ),
          )
          break
        }

        const innerMessage = update.message.message
        const isErrorResult =
          update.message.type === 'user' &&
          Array.isArray(innerMessage?.content) &&
          innerMessage.content.some(
            _ => _.type === 'tool_result' && _.is_error === true,
          )

        if (isErrorResult) {
          thisToolErrored = true
          // Only Bash errors cancel siblings. Bash commands often have implicit
          // dependency chains (e.g. mkdir fails → subsequent commands pointless).
          // Read/WebFetch/etc are independent — one failure shouldn't nuke the rest.
          if (tool.block.name === BASH_TOOL_NAME) {
            this.hasErrored = true
            this.erroredToolDescription = this.getToolDescription(tool)
            this.siblingAbortController.abort('sibling_error')
          }
        }

        if (update.message) {
          // Progress messages go to pendingProgress for immediate yielding
          if (update.message.type === 'progress') {
            tool.pendingProgress.push(update.message)
            // Signal that progress is available
            if (this.progressAvailableResolve) {
              this.progressAvailableResolve()
              this.progressAvailableResolve = undefined
            }
          } else {
            messages.push(update.message)
          }
        }
        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier.modifyContext)
        }
      }
      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.status = 'completed'
      this.updateInterruptibleState()

      // NOTE: we currently don't support context modifiers for concurrent
      //       tools. None are actively being used, but if we want to use
      //       them in concurrent tools, we need to support that here.
      if (!tool.isConcurrencySafe && contextModifiers.length > 0) {
        for (const modifier of contextModifiers) {
          this.toolUseContext = modifier(this.toolUseContext)
        }
      }
    }

    const promise = collectResults()
    tool.promise = promise

    // Process more queue when done
    void promise.finally(() => {
      void this.processQueue()
    })
  }

  /**
   * Get any completed results that haven't been yielded yet (non-blocking)
   * Maintains order where necessary
   * Also yields any pending progress messages immediately
   */
  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    for (const tool of this.tools) {
      // Always yield pending progress messages immediately, regardless of tool status
      while (tool.pendingProgress.length > 0) {
        const progressMessage = tool.pendingProgress.shift()!
        yield { message: progressMessage, newContext: this.toolUseContext }
      }

      if (tool.status === 'yielded') {
        continue
      }

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'

        for (const message of tool.results) {
          yield { message, newContext: this.toolUseContext }
        }

        markToolUseAsComplete(this.toolUseContext, tool.id)
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break
      }
    }
  }

  /**
   * Check if any tool has pending progress messages
   */
  private hasPendingProgress(): boolean {
    return this.tools.some(t => t.pendingProgress.length > 0)
  }

  /**
   * Wait for remaining tools and yield their results as they complete
   * Also yields progress messages as they become available
   */
  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    while (!this.discarded && this.hasUnfinishedTools()) {
      await this.processQueue()

      if (this.discarded) {
        return
      }

      for (const result of this.getCompletedResults()) {
        yield result
      }

      // If we still have executing tools but nothing completed, wait for any to complete
      // OR for progress to become available
      if (
        this.hasExecutingTools() &&
        !this.hasCompletedResults() &&
        !this.hasPendingProgress()
      ) {
        const executingPromises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)

        // Also wait for progress to become available
        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })

        if (executingPromises.length > 0) {
          await Promise.race([...executingPromises, progressPromise])
        }
      }
    }

    for (const result of this.getCompletedResults()) {
      yield result
    }
  }

  /**
   * Check if there are any completed results ready to yield
   */
  private hasCompletedResults(): boolean {
    return this.tools.some(t => t.status === 'completed')
  }

  /**
   * Check if there are any tools still executing
   */
  private hasExecutingTools(): boolean {
    return this.tools.some(t => t.status === 'executing')
  }

  /**
   * Check if there are any unfinished tools
   */
  private hasUnfinishedTools(): boolean {
    return this.tools.some(t => t.status !== 'yielded')
  }

  /**
   * Get the current tool use context (may have been modified by context modifiers)
   */
  getUpdatedContext(): ToolUseContext {
    return this.toolUseContext
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
