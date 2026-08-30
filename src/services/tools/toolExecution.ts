import { feature } from 'bun:bundle'
import type {
  ContentBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@urhq-ai/sdk/resources/index.mjs'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  extractMcpToolDetails,
  extractSkillName,
  extractToolInputForTelemetry,
  getFileExtensionForAnalytics,
  getFileExtensionsFromBashCommand,
  isToolDetailsLoggingEnabled,
  mcpToolDetailsForAnalytics,
  sanitizeToolNameForAnalytics,
} from 'src/services/analytics/metadata.js'
import {
  addToToolDuration,
  getCodeEditToolDecisionCounter,
  getSessionId,
  getStatsStore,
} from '../../bootstrap/state.js'
import { getCwd } from '../../utils/cwd.js'
import { checkUntrustedActionGate } from '../../security/untrustedActionGate.js'
import { stripUnrecognizedKeys } from '../../utils/toolInputSanitize.js'
import {
  buildCodeEditToolAttributes,
  isCodeEditingTool,
} from '../../hooks/toolPermission/permissionLogging.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  findToolByName,
  type Tool,
  type ToolProgress,
  type ToolProgressData,
  type ToolUseContext,
} from '../../Tool.js'
import type { BashToolInput } from '../../tools/BashTool/BashTool.js'
import { normalizeAskUserQuestionInput } from '../../tools/AskUserQuestionTool/AskUserQuestionTool.js'
import {
  describeQuestionPayloadProblems,
  describeQuestionPayloadShape,
} from '../../tools/AskUserQuestionTool/normalizeQuestions.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js'
import { startSpeculativeClassifierCheck } from '../../tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
} from '../../tools/AgentTool/constants.js'
import {
  isShippedReadOnlyAgentDefinition,
  normalizeReadOnlyResearchDelegation,
} from '../../tools/AgentTool/readOnlyAgents.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../../tools/NotebookEditTool/constants.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { parseGitCommitId } from '../../tools/shared/gitOperationTracking.js'
import {
  isDeferredTool,
  TOOL_SEARCH_TOOL_NAME,
} from '../../tools/ToolSearchTool/prompt.js'
import type { HookProgress } from '../../types/hooks.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  StopHookInfo,
} from '../../types/message.js'
import { count } from '../../utils/array.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  AbortError,
  errorMessage,
  getErrnoCode,
  ShellError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../utils/errors.js'
import {
  executePermissionDeniedHooks,
  executeOnFailureHooks,
} from '../../utils/hooks.js'
import { appendProjectMemory } from '../../services/context/projectContextManifest.js'
import { logError } from '../../utils/log.js'
import {
  CANCEL_MESSAGE,
  createProgressMessage,
  createStopHookSummaryMessage,
  createToolResultStopMessage,
  createUserMessage,
  withMemoryCorrectionHint,
} from '../../utils/messages.js'
import type {
  PermissionDecisionReason,
  PermissionResult,
} from '../../utils/permissions/PermissionResult.js'
import {
  startSessionActivity,
  stopSessionActivity,
} from '../../utils/sessionActivity.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getPlanFilePath } from '../../utils/plans.js'
import { expandPath } from '../../utils/path.js'
import { Stream } from '../../utils/stream.js'
import { logOTelEvent } from '../../utils/telemetry/events.js'
import {
  addToolContentEvent,
  endToolBlockedOnUserSpan,
  endToolExecutionSpan,
  endToolSpan,
  isBetaTracingEnabled,
  startToolBlockedOnUserSpan,
  startToolExecutionSpan,
  startToolSpan,
} from '../../utils/telemetry/sessionTracing.js'
import { shouldCaptureGenAiContent } from '../../utils/telemetry/genAiSemantics.js'
import {
  formatError,
  formatZodValidationError,
} from '../../utils/toolErrors.js'
import {
  processPreMappedToolResultBlock,
  processToolResultBlock,
} from '../../utils/toolResultStorage.js'
import {
  getTaskListRunContext,
  getTaskListRunFromMessages,
} from '../../utils/taskListRunContext.js'
import {
  extractDiscoveredToolNames,
  isToolSearchEnabledOptimistic,
  isToolSearchToolAvailable,
  supportsToolReferenceExpansion,
} from '../../utils/toolSearch.js'
import {
  checkTaskListGate,
  countActionableTasksForGate,
} from './taskListGate.js'
import {
  callSignature,
  checkRepeatedFailure,
  recordCallFailure,
  recordCallSuccess,
  REPEATED_FAILURE_DEFAULTS,
  type RepeatedFailureConfig,
  RepeatedToolFailureAbort,
} from './repeatedFailureGuard.js'

const UNKNOWN_TOOL_REPEAT_POLICY = {
  enabled: true,
  limit: 1,
  abortAfter: 3,
} as const

const CODE_EDIT_REPEAT_POLICY = {
  enabled: true,
  limit: 2,
  abortAfter: 3,
  recoveryHint:
    'Read the current target again, then rebuild the edit from the exact current content and use a unique anchor (or replace_all only when every match is intended).',
} as const satisfies RepeatedFailureConfig

/**
 * Code-edit failures are deterministic for unchanged file content and input.
 * Bound only these mutating tools; corrected retries receive a new signature
 * and remain unrestricted, while unrelated tools retain their existing policy.
 */
export function getToolRepeatedFailurePolicy(
  toolName: string,
): RepeatedFailureConfig {
  return toolName === FILE_EDIT_TOOL_NAME ||
    toolName === FILE_WRITE_TOOL_NAME ||
    toolName === NOTEBOOK_EDIT_TOOL_NAME
    ? CODE_EDIT_REPEAT_POLICY
    : REPEATED_FAILURE_DEFAULTS
}

/**
 * How many tasks exist for this session.
 *
 * Returns a permissive count on any failure. A gate that blocks every tool
 * call because the task directory was briefly unreadable would be worse than
 * the problem it solves, so an unknown count is treated as "a list exists".
 */
/**
 * Tool calls already made, which is what the gate's allowance is about.
 * Message count is not a proxy for it: a long conversation with no tool use
 * would exhaust the allowance before the agent had done anything.
 */
function countToolCalls(
  messages: unknown,
  excludedMessageId?: string,
): number {
  if (!Array.isArray(messages)) return 0
  let count = 0
  for (const message of messages) {
    const envelope = (
      message as {
        message?: { id?: unknown; content?: unknown }
      }
    )?.message
    if (
      excludedMessageId !== undefined &&
      envelope?.id === excludedMessageId
    ) {
      continue
    }
    const content = envelope?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if ((block as { type?: string })?.type === 'tool_use') count++
    }
  }
  return count
}

/**
 * Count completed/prior tool calls plus the current response's stable ordinal.
 * Every call in one assistant batch sees the same historical snapshot, so
 * history alone would let an arbitrarily large parallel batch share the
 * trivial-call allowance.
 */
export function countToolCallsBeforeCurrent(
  messages: unknown,
  assistantMessage: AssistantMessage,
  toolUseID: string,
): number {
  const currentMessageId = assistantMessage.message?.id
  let count = countToolCalls(
    messages,
    typeof currentMessageId === 'string' ? currentMessageId : undefined,
  )
  const currentContent = assistantMessage.message?.content
  if (!Array.isArray(currentContent)) return count
  for (const block of currentContent) {
    if (block.type !== 'tool_use') continue
    if (block.id === toolUseID) return count
    count++
  }
  // Missing correlation is treated conservatively as occurring after every
  // tool block currently visible in the response.
  return count
}

async function countTasksForGate(): Promise<number | null> {
  try {
    const { getTaskListId, inspectTaskListForGate } =
      await import('../../utils/tasks.js')
    const inspection = await inspectTaskListForGate(getTaskListId())
    return countActionableTasksForGate(inspection.tasks)
  } catch {
    return null
  }
}

export function isCurrentPlanFileMutation(
  toolName: string,
  input: unknown,
  context: ToolUseContext,
): boolean {
  if (
    context.getAppState().toolPermissionContext.mode !== 'plan' ||
    (toolName !== FILE_WRITE_TOOL_NAME && toolName !== FILE_EDIT_TOOL_NAME) ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return false
  }
  const filePath = (input as { file_path?: unknown }).file_path
  if (typeof filePath !== 'string') return false
  try {
    return expandPath(filePath) === expandPath(getPlanFilePath(context.agentId))
  } catch {
    return false
  }
}

/**
 * Read-only investigation must stay open before implementation tasks exist.
 * Keep shipped Explore/Plan delegation available from the main session without
 * weakening ordinary delegation: custom overrides, nested agents, teammate
 * spawns, and worktree creation still require a real parent task. Their worker
 * permission mode is independently forced to plan/read-only.
 */
export function isReadOnlyBuiltInDelegation(
  toolName: string,
  input: unknown,
  context: ToolUseContext,
): boolean {
  if (
    context.agentId ||
    (toolName !== AGENT_TOOL_NAME && toolName !== LEGACY_AGENT_TOOL_NAME) ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return false
  }

  const delegation = input as {
    subagent_type?: unknown
    name?: unknown
    team_name?: unknown
    isolation?: unknown
  }
  if (
    typeof delegation.subagent_type !== 'string' ||
    delegation.name !== undefined ||
    delegation.team_name !== undefined ||
    delegation.isolation !== undefined
  ) {
    return false
  }

  return context.options.agentDefinitions.activeAgents.some(
    agent =>
      agent.agentType === delegation.subagent_type &&
      isShippedReadOnlyAgentDefinition(agent),
  )
}

function getStopHookInfo(attachment: unknown): StopHookInfo | null {
  if (
    typeof attachment !== 'object' ||
    attachment === null ||
    !('command' in attachment) ||
    typeof attachment.command !== 'string' ||
    !('durationMs' in attachment) ||
    typeof attachment.durationMs !== 'number'
  ) {
    return null
  }
  return {
    command: attachment.command,
    durationMs: attachment.durationMs,
  }
}

function repeatedFailureScope(
  toolUseContext: ToolUseContext,
  fallbackTurnId?: string,
): string {
  if (toolUseContext.queryTracking?.chainId) {
    return `query:${toolUseContext.queryTracking.chainId}`
  }
  return (
    `session:${getSessionId()}:agent:${toolUseContext.agentId ?? 'main'}:` +
    `turn:${fallbackTurnId ?? 'untracked'}`
  )
}
import {
  McpAuthError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../mcp/client.js'
import { mcpInfoFromString } from '../mcp/mcpStringUtils.js'
import { normalizeNameForMCP } from '../mcp/normalization.js'
import type { MCPServerConnection } from '../mcp/types.js'
import {
  getLoggingSafeMcpBaseUrl,
  getMcpServerScopeFromToolName,
  isMcpTool,
} from '../mcp/utils.js'
import {
  resolveHookPermissionDecision,
  runPostToolUseFailureHooks,
  runPostToolUseHooks,
  runPreToolUseHooks,
} from './toolHooks.js'

/** Minimum total hook duration (ms) to show inline timing summary */
export const HOOK_TIMING_DISPLAY_THRESHOLD_MS = 500
/** Log a debug warning when hooks/permission-decision block for this long. Matches
 * BashTool's PROGRESS_THRESHOLD_MS — the collapsed view feels stuck past this. */
const SLOW_PHASE_LOG_THRESHOLD_MS = 2000

/**
 * Classify a tool execution error into a telemetry-safe string.
 *
 * In minified/external builds, `error.constructor.name` is mangled into
 * short identifiers like "nJT" or "Chq" — useless for diagnostics.
 * This function extracts structured, telemetry-safe information instead:
 * - TelemetrySafeError: use its telemetryMessage (already vetted)
 * - Node.js fs errors: log the error code (ENOENT, EACCES, etc.)
 * - Known error types: use their unminified name
 * - Fallback: "Error" (better than a mangled 3-char identifier)
 */
export function classifyToolError(error: unknown): string {
  if (
    error instanceof TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  ) {
    return error.telemetryMessage.slice(0, 200)
  }
  if (error instanceof Error) {
    // Node.js filesystem errors have a `code` property (ENOENT, EACCES, etc.)
    // These are safe to log and much more useful than the constructor name.
    const errnoCode = getErrnoCode(error)
    if (typeof errnoCode === 'string') {
      return `Error:${errnoCode}`
    }
    // ShellError, ImageSizeError, etc. have stable `.name` properties
    // that survive minification (they're set in the constructor).
    if (error.name && error.name !== 'Error' && error.name.length > 3) {
      return error.name.slice(0, 60)
    }
    return 'Error'
  }
  return 'UnknownError'
}

/**
 * Map a rule's origin to the documented OTel `source` vocabulary, matching
 * the interactive path's semantics (permissionLogging.ts:81): session-scoped
 * grants are temporary, on-disk grants are permanent, and user-authored
 * denies are user_reject regardless of persistence. Everything the user
 * didn't write (cliArg, policySettings, projectSettings, flagSettings) is
 * config.
 */
function ruleSourceToOTelSource(
  ruleSource: string,
  behavior: 'allow' | 'deny',
): string {
  switch (ruleSource) {
    case 'session':
      return behavior === 'allow' ? 'user_temporary' : 'user_reject'
    case 'localSettings':
    case 'userSettings':
      return behavior === 'allow' ? 'user_permanent' : 'user_reject'
    default:
      return 'config'
  }
}

/**
 * Map a PermissionDecisionReason to the OTel `source` label for the
 * non-interactive tool_decision path, staying within the documented
 * vocabulary (config, hook, user_permanent, user_temporary, user_reject).
 *
 * For permissionPromptTool, the SDK host may set decisionClassification on
 * the PermissionResult to tell us exactly what happened (once vs always vs
 * cache hit — the host knows, we can't tell from {behavior:'allow'} alone).
 * Without it, we fall back conservatively: allow → user_temporary,
 * deny → user_reject.
 */
function decisionReasonToOTelSource(
  reason: PermissionDecisionReason | undefined,
  behavior: 'allow' | 'deny',
): string {
  if (!reason) {
    return 'config'
  }
  switch (reason.type) {
    case 'permissionPromptTool': {
      // toolResult is typed `unknown` on PermissionDecisionReason but carries
      // the parsed Output from PermissionPromptToolResultSchema. Narrow at
      // runtime rather than widen the cross-file type.
      const toolResult = reason.toolResult as
        | { decisionClassification?: string }
        | undefined
      const classified = toolResult?.decisionClassification
      if (
        classified === 'user_temporary' ||
        classified === 'user_permanent' ||
        classified === 'user_reject'
      ) {
        return classified
      }
      return behavior === 'allow' ? 'user_temporary' : 'user_reject'
    }
    case 'rule':
      return ruleSourceToOTelSource(reason.rule.source, behavior)
    case 'hook':
      return 'hook'
    case 'mode':
    case 'classifier':
    case 'subcommandResults':
    case 'asyncAgent':
    case 'sandboxOverride':
    case 'workingDir':
    case 'safetyCheck':
    case 'other':
      return 'config'
    default: {
      const _exhaustive: never = reason
      return 'config'
    }
  }
}

function getNextImagePasteId(messages: Message[]): number {
  let maxId = 0
  for (const message of messages) {
    if (message.type === 'user' && message.imagePasteIds) {
      for (const id of message.imagePasteIds) {
        if (id > maxId) maxId = id
      }
    }
  }
  return maxId + 1
}

export type MessageUpdateLazy<M extends Message = Message> = {
  message: M
  contextModifier?: {
    toolUseID: string
    modifyContext: (context: ToolUseContext) => ToolUseContext
  }
}

export type McpServerType =
  | 'stdio'
  | 'sse'
  | 'http'
  | 'ws'
  | 'sdk'
  | 'sse-ide'
  | 'ws-ide'
  | 'urai-proxy'
  | undefined

function findMcpServerConnection(
  toolName: string,
  mcpClients: MCPServerConnection[],
): MCPServerConnection | undefined {
  if (!toolName.startsWith('mcp__')) {
    return undefined
  }

  const mcpInfo = mcpInfoFromString(toolName)
  if (!mcpInfo) {
    return undefined
  }

  // mcpInfo.serverName is normalized (e.g., "ur_ai_Slack"), but client.name
  // is the original name (e.g., "ur.com Slack"). Normalize both for comparison.
  return mcpClients.find(
    client => normalizeNameForMCP(client.name) === mcpInfo.serverName,
  )
}

/**
 * Extracts the MCP server transport type from a tool name.
 * Returns the server type (stdio, sse, http, ws, sdk, etc.) for MCP tools,
 * or undefined for built-in tools.
 */
function getMcpServerType(
  toolName: string,
  mcpClients: MCPServerConnection[],
): McpServerType {
  const serverConnection = findMcpServerConnection(toolName, mcpClients)

  if (serverConnection?.type === 'connected') {
    // Handle stdio configs where type field is optional (defaults to 'stdio')
    return serverConnection.config.type ?? 'stdio'
  }

  return undefined
}

/**
 * Extracts the MCP server base URL for a tool by looking up its server connection.
 * Returns undefined for stdio servers, built-in tools, or if the server is not connected.
 */
function getMcpServerBaseUrlFromToolName(
  toolName: string,
  mcpClients: MCPServerConnection[],
): string | undefined {
  const serverConnection = findMcpServerConnection(toolName, mcpClients)
  if (serverConnection?.type !== 'connected') {
    return undefined
  }
  return getLoggingSafeMcpBaseUrl(serverConnection.config)
}

export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  const toolName = toolUse.name
  // Resolve only inside the active profile. findToolByName already recognizes
  // aliases on active tools, so a resumed `KillShell` call still maps to
  // TaskStop when TaskStop is available. Looking in the global registry here
  // would let a provider call an alias for a tool intentionally removed from
  // this agent's profile.
  const tool = findToolByName(toolUseContext.options.tools, toolName)
  const messageId = assistantMessage.message?.id
  if (typeof messageId !== 'string' || messageId.length === 0) {
    throw new Error(
      `Cannot execute tool_use ${toolUse.id}: assistant message has no id`,
    )
  }
  const requestId = assistantMessage.requestId
  const mcpServerType = getMcpServerType(
    toolName,
    toolUseContext.options.mcpClients,
  )
  const mcpServerBaseUrl = getMcpServerBaseUrlFromToolName(
    toolName,
    toolUseContext.options.mcpClients,
  )

  // Check if the tool exists
  if (!tool) {
    const callSig = callSignature(
      toolName,
      toolUse.input,
      repeatedFailureScope(toolUseContext, messageId),
    )
    const repeat = checkRepeatedFailure(callSig, UNKNOWN_TOOL_REPEAT_POLICY)
    if (repeat.action === 'abort') {
      throw new RepeatedToolFailureAbort(
        `Repeated tool failure: ${repeat.reason}`,
      )
    }
    if (repeat.action === 'refuse') {
      // Refused attempts still count. Without this increment the counter
      // freezes at `limit` and can never reach `abortAfter`.
      recordCallFailure(callSig)
      yield {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>RepeatedFailure: ${repeat.reason}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUse.id,
            },
          ],
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      }
      return
    }
    recordCallFailure(callSig)
    const sanitizedToolName = sanitizeToolNameForAnalytics(toolName)
    logForDebugging(`Unknown tool ${toolName}: ${toolUse.id}`)
    logEvent('tengu_tool_use_error', {
      error:
        `No such tool available: ${sanitizedToolName}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizedToolName,
      toolUseID:
        toolUse.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      isMcp: toolName.startsWith('mcp__'),
      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
      ...(mcpServerType && {
        mcpServerType:
          mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(mcpServerBaseUrl && {
        mcpServerBaseUrl:
          mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(requestId && {
        requestId:
          requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...mcpToolDetailsForAnalytics(toolName, mcpServerType, mcpServerBaseUrl),
    })
    const unavailableMessage =
      `Tool "${toolName}" is not available in this agent's active tool ` +
      `profile. Do not retry this tool unchanged. Continue with an available ` +
      `tool, or return the useful partial result so the parent agent can proceed.`
    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>UnavailableTool: ${unavailableMessage}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: `UnavailableTool: ${unavailableMessage}`,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
    return
  }

  const toolInput = toolUse.input as { [key: string]: string }
  try {
    if (toolUseContext.abortController.signal.aborted) {
      logEvent('tengu_tool_use_cancelled', {
        toolName: sanitizeToolNameForAnalytics(tool.name),
        toolUseID:
          toolUse.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        isMcp: tool.isMcp ?? false,

        queryChainId: toolUseContext.queryTracking
          ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        queryDepth: toolUseContext.queryTracking?.depth,
        ...(mcpServerType && {
          mcpServerType:
            mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(mcpServerBaseUrl && {
          mcpServerBaseUrl:
            mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(requestId && {
          requestId:
            requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...mcpToolDetailsForAnalytics(
          tool.name,
          mcpServerType,
          mcpServerBaseUrl,
        ),
      })
      const content = createToolResultStopMessage(toolUse.id)
      content.content = withMemoryCorrectionHint(CANCEL_MESSAGE)
      yield {
        message: createUserMessage({
          content: [content],
          toolUseResult: CANCEL_MESSAGE,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      }
      return
    }

    for await (const update of streamedCheckPermissionsAndCallTool(
      tool,
      toolUse.id,
      toolInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
      messageId,
      requestId,
      mcpServerType,
      mcpServerBaseUrl,
    )) {
      yield update
    }
  } catch (error) {
    if (error instanceof RepeatedToolFailureAbort) {
      throw error
    }
    if (!(error instanceof AbortError)) {
      // Exceptions raised before tool.call() (for example by a hook or
      // permission adapter) bypass the inner execution catch. Count them too,
      // otherwise an identical preflight crash can loop indefinitely.
      recordCallFailure(
        callSignature(
          tool.name,
          toolInput,
          repeatedFailureScope(toolUseContext, messageId),
        ),
      )
    }
    logError(error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const toolInfo = tool ? ` (${tool.name})` : ''
    const detailedError = `Error calling tool${toolInfo}: ${errorMessage}`

    void executeOnFailureHooks(detailedError, 'tool', toolUseContext, {
      toolName: tool?.name,
      toolUseID: toolUse.id,
    }).then(({ memory }) => {
      if (memory) {
        appendProjectMemory(getCwd(), memory.kind, memory.text, {
          rationale: memory.rationale,
          scope: memory.scope,
          source: 'OnFailure hook',
        })
      }
    })

    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${detailedError}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: detailedError,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
  }
}

function streamedCheckPermissionsAndCallTool(
  tool: Tool,
  toolUseID: string,
  input: { [key: string]: boolean | string | number },
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  messageId: string,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>,
): AsyncIterable<MessageUpdateLazy> {
  // This is a bit of a hack to get progress events and final results
  // into a single async iterable.
  //
  // Ideally the progress reporting and tool call reporting would
  // be via separate mechanisms.
  const stream = new Stream<MessageUpdateLazy>()
  checkPermissionsAndCallTool(
    tool,
    toolUseID,
    input,
    toolUseContext,
    canUseTool,
    assistantMessage,
    messageId,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
    progress => {
      logEvent('tengu_tool_use_progress', {
        messageID:
          messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toolName: sanitizeToolNameForAnalytics(tool.name),
        isMcp: tool.isMcp ?? false,

        queryChainId: toolUseContext.queryTracking
          ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        queryDepth: toolUseContext.queryTracking?.depth,
        ...(mcpServerType && {
          mcpServerType:
            mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(mcpServerBaseUrl && {
          mcpServerBaseUrl:
            mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(requestId && {
          requestId:
            requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...mcpToolDetailsForAnalytics(
          tool.name,
          mcpServerType,
          mcpServerBaseUrl,
        ),
      })
      if (!progress.toolUseID || progress.data === undefined) {
        logForDebugging(
          `Ignoring malformed progress update for ${tool.name}: missing toolUseID or data`,
          { level: 'warn' },
        )
        return
      }
      stream.enqueue({
        message: createProgressMessage({
          toolUseID: progress.toolUseID,
          parentToolUseID: toolUseID,
          data: progress.data,
        }),
      })
    },
  )
    .then(results => {
      for (const result of results) {
        stream.enqueue(result)
      }
    })
    .catch(error => {
      stream.error(error)
    })
    .finally(() => {
      stream.done()
    })
  return stream
}

/**
 * Appended to Zod errors when a deferred tool genuinely wasn't in the
 * discovered-tool set, telling the model to load it before retrying.
 *
 * The gating must match ur.ts's real `useToolSearch` decision. It previously
 * did not: `isToolSearchEnabledOptimistic` ignores runtime support, so on a
 * runtime where tool search is off — meaning every schema *was* sent — a
 * mis-shaped tool call was answered with "this tool's schema was not sent",
 * which is false, plus advice to call a ToolSearch that isn't in the tool list.
 * The model believed it and burned a turn. A wrong explanation is worse than
 * none: the raw Zod error already says which field is wrong.
 *
 * Returns null when the schema was sent.
 */
export function buildSchemaNotSentHint(
  tool: Tool,
  messages: Message[],
  tools: readonly { name: string }[],
): string | null {
  // Tool search requires tool_reference expansion. Without it ur.ts disables
  // tool search entirely and sends every schema, so nothing is undiscovered.
  if (!supportsToolReferenceExpansion()) return null
  if (!isToolSearchEnabledOptimistic()) return null
  if (!isToolSearchToolAvailable(tools)) return null
  if (!isDeferredTool(tool)) return null
  const discovered = extractDiscoveredToolNames(messages)
  if (discovered.has(tool.name)) return null
  return (
    `\n\nThis tool's schema was not sent to the API — it was not in the discovered-tool set derived from message history. ` +
    `Without the schema in your prompt, typed parameters (arrays, numbers, booleans) get emitted as strings and the client-side parser rejects them. ` +
    `Load the tool first: call ${TOOL_SEARCH_TOOL_NAME} with query "select:${tool.name}", then retry this call.`
  )
}

async function checkPermissionsAndCallTool(
  tool: Tool,
  toolUseID: string,
  input: { [key: string]: boolean | string | number },
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  messageId: string,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>,
  onToolProgress: (
    progress: ToolProgress<ToolProgressData> | ProgressMessage<HookProgress>,
  ) => void,
): Promise<MessageUpdateLazy[]> {
  // Validate input types with zod (surprisingly, the model is not great at generating valid input)
  let parsedInput = tool.inputSchema.safeParse(input)
  // Tolerate hallucinated extra parameters: if the ONLY problem is unrecognized
  // keys (e.g. `title`/`description` on a Write call), strip them and re-validate
  // instead of failing the whole call. Other errors (missing required, type
  // mismatch) still surface normally.
  if (
    !parsedInput.success &&
    parsedInput.error.issues.length > 0 &&
    parsedInput.error.issues.every(issue => issue.code === 'unrecognized_keys')
  ) {
    const { input: cleaned, stripped } = stripUnrecognizedKeys(
      input,
      parsedInput.error.issues,
    )
    if (stripped.length > 0) {
      const retry = tool.inputSchema.safeParse(cleaned)
      if (retry.success) {
        logEvent('tengu_tool_input_unrecognized_keys_stripped', {
          toolName: sanitizeToolNameForAnalytics(tool.name),
        })
        input = cleaned as typeof input
        parsedInput = retry
      }
    }
  }

  // Several model families select general-purpose for a research-only brief;
  // some also omit the caller's explicit "read-only" wording. Downgrade that
  // constrained main-session shape to the shipped Explore definition before
  // task gating. This is capability
  // reduction, not a text-based permission grant: Explore is mechanically
  // plan/read-only and omits editing tools. Later hook/permission rewrites are
  // independently revalidated against the final task gate below.
  if (
    parsedInput.success &&
    (tool.name === AGENT_TOOL_NAME || tool.name === LEGACY_AGENT_TOOL_NAME)
  ) {
    const normalizedDelegation = normalizeReadOnlyResearchDelegation(
      parsedInput.data as Record<string, unknown>,
      toolUseContext.options.agentDefinitions.activeAgents,
      Boolean(toolUseContext.agentId),
    )
    if (normalizedDelegation !== parsedInput.data) {
      input = normalizedDelegation as typeof input
      parsedInput = tool.inputSchema.safeParse(input)
      logEvent('tengu_agent_read_only_research_normalized', {
        toolName: sanitizeToolNameForAnalytics(tool.name),
      })
    }
  }

  // Break a loop before anything else. A model that cannot recover from a
  // refusal will repeat the same malformed call indefinitely, and every other
  // check here would keep rejecting it politely forever.
  let callSig = callSignature(
    tool.name,
    input,
    repeatedFailureScope(toolUseContext, messageId),
  )
  const repeat = checkRepeatedFailure(
    callSig,
    getToolRepeatedFailurePolicy(tool.name),
  )
  if (repeat.action !== 'allow') {
    logEvent('tengu_repeated_failure_guard', {
      toolName: sanitizeToolNameForAnalytics(tool.name),
      action: repeat.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (repeat.action === 'abort') {
      throw new RepeatedToolFailureAbort(
        `Repeated tool failure: ${repeat.reason}`,
      )
    }
    // A refusal is itself another unchanged attempt. Count it so a model that
    // ignores the refusal reaches abortAfter instead of being refused forever.
    recordCallFailure(callSig)
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>RepeatedFailure: ${repeat.reason}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
        }),
      },
    ]
  }

  if (!parsedInput.success) {
    // The loop that prompted this guard was `Write` with no arguments,
    // rejected here every time. Without recording it, the guard never counts.
    recordCallFailure(callSig)
    const normalizedQuestionInput =
      tool.name === ASK_USER_QUESTION_TOOL_NAME
        ? normalizeAskUserQuestionInput(input)
        : undefined
    const questionProblems =
      normalizedQuestionInput === undefined
        ? []
        : describeQuestionPayloadProblems(normalizedQuestionInput)
    let errorContent =
      questionProblems.length > 0
        ? // The shape is appended here rather than folded into the problem
          // list, which describes only what is wrong. Naming what arrived is
          // what separates an unrepairable payload from a shape the normalizer
          // has not been taught yet.
          `${tool.name} input cannot be rendered: ${questionProblems.join(' ')} ${describeQuestionPayloadShape(normalizedQuestionInput)}`.trim()
        : formatZodValidationError(tool.name, parsedInput.error)

    const schemaHint = buildSchemaNotSentHint(
      tool,
      toolUseContext.messages,
      toolUseContext.options.tools,
    )
    if (schemaHint) {
      logEvent('tengu_deferred_tool_schema_not_sent', {
        toolName: sanitizeToolNameForAnalytics(tool.name),
        isMcp: tool.isMcp ?? false,
      })
      errorContent += schemaHint
    }

    logForDebugging(
      `${tool.name} tool input error: ${errorContent.slice(0, 200)}`,
    )
    logEvent('tengu_tool_use_error', {
      error:
        'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorDetails: errorContent.slice(
        0,
        2000,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: tool.isMcp ?? false,

      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
      ...(mcpServerType && {
        mcpServerType:
          mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(mcpServerBaseUrl && {
        mcpServerBaseUrl:
          mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(requestId && {
        requestId:
          requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
    })
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>InputValidationError: ${errorContent}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `InputValidationError: ${parsedInput.error.message}`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }

  // Validate input values. Each tool has its own validation logic
  const isValidCall = await tool.validateInput?.(
    parsedInput.data,
    toolUseContext,
  )
  if (isValidCall?.result === false) {
    recordCallFailure(callSig)
    logForDebugging(
      `${tool.name} tool validation error: ${isValidCall.message?.slice(0, 200)}`,
    )
    logEvent('tengu_tool_use_error', {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      error:
        isValidCall.message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode: isValidCall.errorCode,
      isMcp: tool.isMcp ?? false,

      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
      ...(mcpServerType && {
        mcpServerType:
          mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(mcpServerBaseUrl && {
        mcpServerBaseUrl:
          mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(requestId && {
        requestId:
          requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
    })
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>${isValidCall.message}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `Error: ${isValidCall.message}`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }
  const initiallyValidatedCallSig = callSig

  // Require a plan before anything is changed. The resolved tool is the
  // authority: a fixed name list missed PowerShell, Computer, MCP tools,
  // aliases and future mutators, while falsely blocking read-only Bash/API
  // calls. Tool defaults classify unknown implementations as non-read-only.
  let isMutating = true
  try {
    isMutating = !tool.isReadOnly(parsedInput.data)
  } catch {
    // Classification failures must not become a bypass.
    isMutating = true
  }
  const taskListRun =
    getTaskListRunContext() ??
    (toolUseContext.agentId
      ? undefined
      : getTaskListRunFromMessages(toolUseContext.messages ?? []))
  const gate = checkTaskListGate({
    toolName: tool.name,
    taskCount: await countTasksForGate(),
    // Tool calls, not messages. Counting messages meant any conversation at
    // all pushed this past the threshold, so the allowance for simple
    // single-step work never applied and the gate fired on the first Write.
    readsSoFar: countToolCallsBeforeCurrent(
      toolUseContext.messages,
      assistantMessage,
      toolUseID,
    ),
    isSubagent: Boolean(toolUseContext.agentId),
    isMutating,
    requiresTaskList: taskListRun?.requiresTaskList,
    requirementReason: taskListRun?.requirementReason,
    isPlanningArtifact: isCurrentPlanFileMutation(
      tool.name,
      parsedInput.data,
      toolUseContext,
    ),
    isReadOnlyBuiltInDelegation: isReadOnlyBuiltInDelegation(
      tool.name,
      parsedInput.data,
      toolUseContext,
    ),
    taskListWriterAvailable: toolUseContext.options.tools.some(
      candidate => candidate.name === 'TaskCreate',
    ),
  })
  if (gate.allowed === false) {
    // Counts toward the repeat guard: a model that answers the gate by
    // re-sending the same call is exactly the loop this protects against.
    recordCallFailure(callSig)
    logEvent('tengu_task_list_gate_blocked', {
      toolName: sanitizeToolNameForAnalytics(tool.name),
    })
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>TaskListRequired: ${gate.reason}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
        }),
      },
    ]
  }
  // Speculatively start the bash allow classifier check early so it runs in
  // parallel with pre-tool hooks, deny/ask classifiers, and permission dialog
  // setup. The UI indicator (setClassifierChecking) is NOT set here — it's
  // set in interactiveHandler.ts only when the permission check returns `ask`
  // with a pendingClassifierCheck. This avoids flashing "classifier running"
  // for commands that auto-allow via prefix rules.
  if (
    tool.name === BASH_TOOL_NAME &&
    parsedInput.data &&
    'command' in parsedInput.data
  ) {
    const appState = toolUseContext.getAppState()
    startSpeculativeClassifierCheck(
      (parsedInput.data as BashToolInput).command,
      appState.toolPermissionContext,
      toolUseContext.abortController.signal,
      toolUseContext.options.isNonInteractiveSession,
    )
  }

  const resultingMessages = []

  // Defense-in-depth: strip _simulatedSedEdit from model-provided Bash input.
  // This field is internal-only — it must only be injected by the permission
  // system (SedEditPermissionRequest) after user approval. If the model supplies
  // it, the schema's strictObject should already reject it, but we strip here
  // as a safeguard against future regressions.
  let processedInput = parsedInput.data
  if (
    tool.name === BASH_TOOL_NAME &&
    processedInput &&
    typeof processedInput === 'object' &&
    '_simulatedSedEdit' in processedInput
  ) {
    const { _simulatedSedEdit: _, ...rest } =
      processedInput as typeof processedInput & {
        _simulatedSedEdit: unknown
      }
    processedInput = rest as typeof processedInput
  }

  // Backfill legacy/derived fields on a shallow clone so hooks/canUseTool see
  // them without affecting tool.call(). SendMessageTool adds fields; file
  // tools overwrite file_path with expandPath — that mutation must not reach
  // call() because tool results embed the input path verbatim (e.g. "File
  // created successfully at: {path}"), and changing it alters the serialized
  // transcript and VCR fixture hashes. If a hook/permission later returns a
  // fresh updatedInput, callInput converges on it below — that replacement
  // is intentional and should reach call().
  let callInput = processedInput
  const backfilledClone =
    tool.backfillObservableInput &&
    typeof processedInput === 'object' &&
    processedInput !== null
      ? ({ ...processedInput } as typeof processedInput)
      : null
  if (backfilledClone) {
    tool.backfillObservableInput!(backfilledClone as Record<string, unknown>)
    processedInput = backfilledClone
  }

  let shouldPreventContinuation = false
  let stopReason: string | undefined
  let hookPermissionResult: PermissionResult | undefined
  const preToolHookInfos: StopHookInfo[] = []
  const preToolHookStart = Date.now()
  for await (const result of runPreToolUseHooks(
    toolUseContext,
    tool,
    processedInput,
    toolUseID,
    messageId,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
  )) {
    switch (result.type) {
      case 'message':
        if (result.message.message.type === 'progress') {
          onToolProgress(result.message.message)
        } else {
          resultingMessages.push(result.message)
          const stopHookInfo = getStopHookInfo(
            result.message.message.attachment,
          )
          if (stopHookInfo) preToolHookInfos.push(stopHookInfo)
        }
        break
      case 'hookPermissionResult':
        hookPermissionResult = result.hookPermissionResult
        break
      case 'hookUpdatedInput':
        // Hook provided updatedInput without making a permission decision (passthrough)
        // Update processedInput so it's used in the normal permission flow
        processedInput = result.updatedInput
        break
      case 'preventContinuation':
        shouldPreventContinuation = result.shouldPreventContinuation
        break
      case 'stopReason':
        stopReason = result.stopReason
        break
      case 'additionalContext':
        resultingMessages.push(result.message)
        break
      case 'stop':
        getStatsStore()?.observe(
          'pre_tool_hook_duration_ms',
          Date.now() - preToolHookStart,
        )
        callSig = callSignature(
          tool.name,
          processedInput,
          repeatedFailureScope(toolUseContext, messageId),
        )
        {
          const stoppedRepeat = checkRepeatedFailure(callSig)
          if (stoppedRepeat.action === 'abort') {
            throw new RepeatedToolFailureAbort(
              `Repeated tool failure: ${stoppedRepeat.reason}`,
            )
          }
          recordCallFailure(callSig)
          if (stoppedRepeat.action === 'refuse') {
            resultingMessages.push({
              message: createUserMessage({
                content: [
                  {
                    type: 'tool_result',
                    content: `<tool_use_error>RepeatedFailure: ${stoppedRepeat.reason}</tool_use_error>`,
                    is_error: true,
                    tool_use_id: toolUseID,
                  },
                ],
                sourceToolAssistantUUID: assistantMessage.uuid,
              }),
            })
            return resultingMessages
          }
        }
        resultingMessages.push({
          message: createUserMessage({
            content: [createToolResultStopMessage(toolUseID)],
            toolUseResult: `Error: ${stopReason}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        })
        return resultingMessages
    }
  }
  const preToolHookDurationMs = Date.now() - preToolHookStart
  getStatsStore()?.observe('pre_tool_hook_duration_ms', preToolHookDurationMs)
  if (preToolHookDurationMs >= SLOW_PHASE_LOG_THRESHOLD_MS) {
    logForDebugging(
      `Slow PreToolUse hooks: ${preToolHookDurationMs}ms for ${tool.name} (${preToolHookInfos.length} hooks)`,
      { level: 'info' },
    )
  }

  // Emit PreToolUse summary immediately so it's visible while the tool executes.
  // Use wall-clock time (not sum of individual durations) since hooks run in parallel.
  if (process.env.USER_TYPE === 'ant' && preToolHookInfos.length > 0) {
    if (preToolHookDurationMs > HOOK_TIMING_DISPLAY_THRESHOLD_MS) {
      resultingMessages.push({
        message: createStopHookSummaryMessage(
          preToolHookInfos.length,
          preToolHookInfos,
          [],
          false,
          undefined,
          false,
          'suggestion',
          undefined,
          'PreToolUse',
          preToolHookDurationMs,
        ),
      })
    }
  }

  const toolAttributes: Record<string, string | number | boolean> = {}
  if (processedInput && typeof processedInput === 'object') {
    if (tool.name === FILE_READ_TOOL_NAME && 'file_path' in processedInput) {
      toolAttributes.file_path = String(processedInput.file_path)
    } else if (
      (tool.name === FILE_EDIT_TOOL_NAME ||
        tool.name === FILE_WRITE_TOOL_NAME) &&
      'file_path' in processedInput
    ) {
      toolAttributes.file_path = String(processedInput.file_path)
    } else if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
      const bashInput = processedInput as BashToolInput
      toolAttributes.full_command = bashInput.command
    }
  }

  startToolSpan(
    tool.name,
    toolAttributes,
    isBetaTracingEnabled() || shouldCaptureGenAiContent()
      ? jsonStringify(processedInput)
      : undefined,
  )
  startToolBlockedOnUserSpan()

  // Check whether we have permission to use the tool,
  // and ask the user for permission if we don't
  const permissionMode = toolUseContext.getAppState().toolPermissionContext.mode
  const permissionStart = Date.now()

  // Provenance is an enforcement input, not prompt decoration. A hook cannot
  // silently approve an action derived from recently detected hostile content,
  // and a leaked privileged canary is always denied.
  const provenanceDecision = checkUntrustedActionGate(tool, processedInput)
  if (
    provenanceDecision &&
    (provenanceDecision.behavior === 'deny' ||
      hookPermissionResult?.behavior !== 'deny')
  ) {
    hookPermissionResult = provenanceDecision
  }

  const resolved = await resolveHookPermissionDecision(
    hookPermissionResult,
    tool,
    processedInput,
    toolUseContext,
    canUseTool,
    assistantMessage,
    toolUseID,
  )
  const permissionDecision = resolved.decision
  processedInput = resolved.input
  // Permission and PreToolUse hooks may replace the model's input. Attribute
  // denials and later outcomes to the effective call, not to stale arguments.
  callSig = callSignature(
    tool.name,
    processedInput,
    repeatedFailureScope(toolUseContext, messageId),
  )
  const permissionDurationMs = Date.now() - permissionStart
  // In auto mode, canUseTool awaits the classifier (side_query) — if that's
  // slow the collapsed view shows "Running…" with no (Ns) tick since
  // bash_progress hasn't started yet. Auto-only: in default mode this timer
  // includes interactive-dialog wait (user think time), which is just noise.
  if (
    permissionDurationMs >= SLOW_PHASE_LOG_THRESHOLD_MS &&
    permissionMode === 'auto'
  ) {
    logForDebugging(
      `Slow permission decision: ${permissionDurationMs}ms for ${tool.name} ` +
        `(mode=${permissionMode}, behavior=${permissionDecision.behavior})`,
      { level: 'info' },
    )
  }

  // Emit tool_decision OTel event and code-edit counter if the interactive
  // permission path didn't already log it (headless mode bypasses permission
  // logging, so we need to emit both the generic event and the code-edit
  // counter here)
  if (
    permissionDecision.behavior !== 'ask' &&
    !toolUseContext.toolDecisions?.has(toolUseID)
  ) {
    const decision =
      permissionDecision.behavior === 'allow' ? 'accept' : 'reject'
    const source = decisionReasonToOTelSource(
      permissionDecision.decisionReason,
      permissionDecision.behavior,
    )
    void logOTelEvent('tool_decision', {
      decision,
      source,
      tool_name: sanitizeToolNameForAnalytics(tool.name),
    })

    // Increment code-edit tool decision counter for headless mode
    if (isCodeEditingTool(tool.name)) {
      void buildCodeEditToolAttributes(
        tool,
        processedInput,
        decision,
        source,
      ).then(attributes => getCodeEditToolDecisionCounter()?.add(1, attributes))
    }
  }

  // Add message if permission was granted/denied by PermissionRequest hook
  if (
    permissionDecision.decisionReason?.type === 'hook' &&
    permissionDecision.decisionReason.hookName === 'PermissionRequest' &&
    permissionDecision.behavior !== 'ask'
  ) {
    resultingMessages.push({
      message: createAttachmentMessage({
        type: 'hook_permission_decision',
        decision: permissionDecision.behavior,
        toolUseID,
        hookEvent: 'PermissionRequest',
      }),
    })
  }

  if (permissionDecision.behavior !== 'allow') {
    recordCallFailure(callSig)
    logForDebugging(`${tool.name} tool permission denied`)
    const decisionInfo = toolUseContext.toolDecisions?.get(toolUseID)
    endToolBlockedOnUserSpan('reject', decisionInfo?.source || 'unknown')
    endToolSpan()

    logEvent('tengu_tool_use_can_use_tool_rejected', {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),

      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
      ...(mcpServerType && {
        mcpServerType:
          mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(mcpServerBaseUrl && {
        mcpServerBaseUrl:
          mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(requestId && {
        requestId:
          requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
    })
    let errorMessage = permissionDecision.message
    // Only use generic "Execution stopped" message if we don't have a detailed hook message
    if (shouldPreventContinuation && !errorMessage) {
      errorMessage = `Execution stopped by PreToolUse hook${stopReason ? `: ${stopReason}` : ''}`
    }

    // Build top-level content: tool_result (text-only for is_error compatibility) + images alongside
    const messageContent: ContentBlockParam[] = [
      {
        type: 'tool_result',
        content: errorMessage,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ]

    // Add image blocks at top level (not inside tool_result, which rejects non-text with is_error)
    const rejectContentBlocks =
      permissionDecision.behavior === 'ask'
        ? permissionDecision.contentBlocks
        : undefined
    if (rejectContentBlocks?.length) {
      messageContent.push(...rejectContentBlocks)
    }

    // Generate sequential imagePasteIds so each image renders with a distinct label
    let rejectImageIds: number[] | undefined
    if (rejectContentBlocks?.length) {
      const imageCount = count(
        rejectContentBlocks,
        (b: ContentBlockParam) => b.type === 'image',
      )
      if (imageCount > 0) {
        const startId = getNextImagePasteId(toolUseContext.messages)
        rejectImageIds = Array.from(
          { length: imageCount },
          (_, i) => startId + i,
        )
      }
    }

    resultingMessages.push({
      message: createUserMessage({
        content: messageContent,
        imagePasteIds: rejectImageIds,
        toolUseResult: `Error: ${errorMessage}`,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    })

    // Run PermissionDenied hooks for auto mode classifier denials.
    // If a hook returns {retry: true}, tell the model it may retry.
    if (
      feature('TRANSCRIPT_CLASSIFIER') &&
      permissionDecision.decisionReason?.type === 'classifier' &&
      permissionDecision.decisionReason.classifier === 'auto-mode'
    ) {
      let hookSaysRetry = false
      for await (const result of executePermissionDeniedHooks(
        tool.name,
        toolUseID,
        processedInput,
        permissionDecision.decisionReason.reason ?? 'Permission denied',
        toolUseContext,
        permissionMode,
        toolUseContext.abortController.signal,
      )) {
        if (result.retry) hookSaysRetry = true
      }
      if (hookSaysRetry) {
        resultingMessages.push({
          message: createUserMessage({
            content:
              'The PermissionDenied hook indicated this command is now approved. You may retry it if you would like.',
            isMeta: true,
          }),
        })
      }
    }

    return resultingMessages
  }
  logEvent('tengu_tool_use_can_use_tool_allowed', {
    messageID:
      messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    toolName: sanitizeToolNameForAnalytics(tool.name),

    queryChainId: toolUseContext.queryTracking
      ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    queryDepth: toolUseContext.queryTracking?.depth,
    ...(mcpServerType && {
      mcpServerType:
        mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(mcpServerBaseUrl && {
      mcpServerBaseUrl:
        mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(requestId && {
      requestId:
        requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
  })

  // Use the updated input from permissions if provided
  // (Don't overwrite if undefined - processedInput may have been modified by passthrough hooks)
  if (permissionDecision.updatedInput !== undefined) {
    processedInput = permissionDecision.updatedInput
  }

  // Converge on the exact input that tool.call() will receive before the last
  // validation/gate pass. Permission/hook flows may return a fresh object
  // derived from the observable backfill clone. For file tools, restore the
  // model's original path when the hook did not actually change it; this keeps
  // transcript/VCR output stable while all other hook changes flow through.
  if (
    backfilledClone &&
    processedInput !== callInput &&
    typeof processedInput === 'object' &&
    processedInput !== null &&
    'file_path' in processedInput &&
    'file_path' in (callInput as Record<string, unknown>) &&
    (processedInput as Record<string, unknown>).file_path ===
      (backfilledClone as Record<string, unknown>).file_path
  ) {
    callInput = {
      ...processedInput,
      file_path: (callInput as Record<string, unknown>).file_path,
    } as typeof processedInput
  } else if (processedInput !== backfilledClone) {
    callInput = processedInput
  }

  const finishPreExecutionRejection = (): void => {
    const info = toolUseContext.toolDecisions?.get(toolUseID)
    endToolBlockedOnUserSpan('reject', info?.source || 'config')
    endToolSpan()
    toolUseContext.toolDecisions?.delete(toolUseID)
  }

  // Hooks and interactive permission UIs are allowed to rewrite input, but
  // rewritten values are not trusted to preserve schema, semantic validation,
  // read-only classification, or repeated-failure identity. Re-check the exact
  // effective call immediately before execution.
  const finalParsedInput = tool.inputSchema.safeParse(callInput)
  if (!finalParsedInput.success) {
    callSig = callSignature(
      tool.name,
      callInput,
      repeatedFailureScope(toolUseContext, messageId),
    )
    const finalRepeat = checkRepeatedFailure(callSig)
    if (finalRepeat.action === 'abort') {
      finishPreExecutionRejection()
      throw new RepeatedToolFailureAbort(
        `Repeated tool failure: ${finalRepeat.reason}`,
      )
    }
    if (finalRepeat.action === 'refuse') {
      recordCallFailure(callSig)
      finishPreExecutionRejection()
      resultingMessages.push({
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>RepeatedFailure: ${finalRepeat.reason}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      })
      return resultingMessages
    }

    recordCallFailure(callSig)
    const finalInputError = formatZodValidationError(
      tool.name,
      finalParsedInput.error,
    )
    finishPreExecutionRejection()
    resultingMessages.push({
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>InputValidationError after input update: ${finalInputError}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUseID,
          },
        ],
        toolUseResult: `InputValidationError: ${finalParsedInput.error.message}`,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    })
    return resultingMessages
  }

  callInput = finalParsedInput.data
  callSig = callSignature(
    tool.name,
    callInput,
    repeatedFailureScope(toolUseContext, messageId),
  )
  // Permission UIs and hooks can rewrite an already-approved input. Re-run the
  // non-approvable canary invariant on the exact validated call so no rewrite
  // can smuggle privileged prompt material across the tool boundary. The
  // suspicious-source approval is intentionally not repeated after the user
  // has already approved it above.
  const finalProvenanceDecision = checkUntrustedActionGate(
    tool,
    finalParsedInput.data,
    { evidence: [] },
  )
  if (finalProvenanceDecision?.behavior === 'deny') {
    recordCallFailure(callSig)
    finishPreExecutionRejection()
    resultingMessages.push({
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${finalProvenanceDecision.message}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUseID,
          },
        ],
        toolUseResult: `Error: ${finalProvenanceDecision.message}`,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    })
    return resultingMessages
  }
  const finalRepeat = checkRepeatedFailure(callSig)
  if (finalRepeat.action === 'abort') {
    finishPreExecutionRejection()
    throw new RepeatedToolFailureAbort(
      `Repeated tool failure: ${finalRepeat.reason}`,
    )
  }
  if (finalRepeat.action === 'refuse') {
    recordCallFailure(callSig)
    finishPreExecutionRejection()
    resultingMessages.push({
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>RepeatedFailure: ${finalRepeat.reason}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUseID,
          },
        ],
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    })
    return resultingMessages
  }

  if (callSig !== initiallyValidatedCallSig) {
    const finalValidation = await tool.validateInput?.(
      finalParsedInput.data,
      toolUseContext,
    )
    if (finalValidation?.result === false) {
      recordCallFailure(callSig)
      finishPreExecutionRejection()
      resultingMessages.push({
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>${finalValidation.message}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `Error: ${finalValidation.message}`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      })
      return resultingMessages
    }
  }

  let finalIsMutating = true
  try {
    finalIsMutating = !tool.isReadOnly(finalParsedInput.data)
  } catch {
    finalIsMutating = true
  }
  if (callSig !== initiallyValidatedCallSig || finalIsMutating !== isMutating) {
    const finalGate = checkTaskListGate({
      toolName: tool.name,
      taskCount: await countTasksForGate(),
      readsSoFar: countToolCallsBeforeCurrent(
        toolUseContext.messages,
        assistantMessage,
        toolUseID,
      ),
      isSubagent: Boolean(toolUseContext.agentId),
      isMutating: finalIsMutating,
      requiresTaskList: taskListRun?.requiresTaskList,
      requirementReason: taskListRun?.requirementReason,
      isPlanningArtifact: isCurrentPlanFileMutation(
        tool.name,
        finalParsedInput.data,
        toolUseContext,
      ),
      isReadOnlyBuiltInDelegation: isReadOnlyBuiltInDelegation(
        tool.name,
        finalParsedInput.data,
        toolUseContext,
      ),
      taskListWriterAvailable: toolUseContext.options.tools.some(
        candidate => candidate.name === 'TaskCreate',
      ),
    })
    if (finalGate.allowed === false) {
      recordCallFailure(callSig)
      finishPreExecutionRejection()
      resultingMessages.push({
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>TaskListRequired after input update: ${finalGate.reason}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      })
      return resultingMessages
    }
  }

  // Prepare tool parameters for logging in tool_result event.
  // Gated by OTEL_LOG_TOOL_DETAILS — tool parameters can contain sensitive
  // content (bash commands, MCP server names, etc.) so they're opt-in only.
  const telemetryToolInput = extractToolInputForTelemetry(processedInput)
  let toolParameters: Record<string, unknown> = {}
  if (isToolDetailsLoggingEnabled()) {
    if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
      const bashInput = processedInput as BashToolInput
      const commandParts = bashInput.command.trim().split(/\s+/)
      const bashCommand = commandParts[0] || ''

      toolParameters = {
        bash_command: bashCommand,
        full_command: bashInput.command,
        ...(bashInput.timeout !== undefined && {
          timeout: bashInput.timeout,
        }),
        ...(bashInput.description !== undefined && {
          description: bashInput.description,
        }),
        ...('dangerouslyDisableSandbox' in bashInput && {
          dangerouslyDisableSandbox: bashInput.dangerouslyDisableSandbox,
        }),
      }
    }

    const mcpDetails = extractMcpToolDetails(tool.name)
    if (mcpDetails) {
      toolParameters.mcp_server_name = mcpDetails.serverName
      toolParameters.mcp_tool_name = mcpDetails.mcpToolName
    }
    const skillName = extractSkillName(tool.name, processedInput)
    if (skillName) {
      toolParameters.skill_name = skillName
    }
  }

  const decisionInfo = toolUseContext.toolDecisions?.get(toolUseID)
  endToolBlockedOnUserSpan(
    decisionInfo?.decision || 'unknown',
    decisionInfo?.source || 'unknown',
  )
  startToolExecutionSpan()

  const startTime = Date.now()

  startSessionActivity('tool_exec')
  try {
    const result = await tool.call(
      callInput,
      {
        ...toolUseContext,
        toolUseId: toolUseID,
        userModified: permissionDecision.userModified ?? false,
      },
      canUseTool,
      assistantMessage,
      progress => {
        onToolProgress({
          toolUseID: progress.toolUseID,
          data: progress.data,
        })
      },
    )
    const durationMs = Date.now() - startTime
    addToToolDuration(durationMs)

    // Log tool content/output as span event if enabled
    if (result.data && typeof result.data === 'object') {
      const contentAttributes: Record<string, string | number | boolean> = {}

      // Read tool: capture file_path and content
      if (tool.name === FILE_READ_TOOL_NAME && 'content' in result.data) {
        if ('file_path' in processedInput) {
          contentAttributes.file_path = String(processedInput.file_path)
        }
        contentAttributes.content = String(result.data.content)
      }

      // Edit/Write tools: capture file_path and diff
      if (
        (tool.name === FILE_EDIT_TOOL_NAME ||
          tool.name === FILE_WRITE_TOOL_NAME) &&
        'file_path' in processedInput
      ) {
        contentAttributes.file_path = String(processedInput.file_path)

        // For Edit, capture the actual changes made
        if (tool.name === FILE_EDIT_TOOL_NAME && 'diff' in result.data) {
          contentAttributes.diff = String(result.data.diff)
        }
        // For Write, capture the written content
        if (tool.name === FILE_WRITE_TOOL_NAME && 'content' in processedInput) {
          contentAttributes.content = String(processedInput.content)
        }
      }

      // Bash tool: capture command
      if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
        const bashInput = processedInput as BashToolInput
        contentAttributes.bash_command = bashInput.command
        // Also capture output if available
        if ('output' in result.data) {
          contentAttributes.output = String(result.data.output)
        }
      }

      if (Object.keys(contentAttributes).length > 0) {
        addToolContentEvent('tool.output', contentAttributes)
      }
    }

    // Capture structured output from tool result if present
    if (typeof result === 'object' && 'structured_output' in result) {
      // Store the structured output in an attachment message
      resultingMessages.push({
        message: createAttachmentMessage({
          type: 'structured_output',
          data: result.structured_output,
        }),
      })
    }

    endToolExecutionSpan({ success: true })
    // Pass tool result for new_context logging
    const toolResultStr =
      result.data && typeof result.data === 'object'
        ? jsonStringify(result.data)
        : String(result.data ?? '')
    endToolSpan(toolResultStr)

    // Map the tool result to API format once and cache it. This block is reused
    // by addToolResult (skipping the remap) and measured here for analytics.
    const mappedToolResultBlock = tool.mapToolResultToToolResultBlockParam(
      result.data,
      toolUseID,
    )
    const mappedContent = mappedToolResultBlock.content
    const toolResultSizeBytes = !mappedContent
      ? 0
      : typeof mappedContent === 'string'
        ? mappedContent.length
        : jsonStringify(mappedContent).length

    // Extract file extension for file-related tools
    let fileExtension: ReturnType<typeof getFileExtensionForAnalytics>
    if (processedInput && typeof processedInput === 'object') {
      if (
        (tool.name === FILE_READ_TOOL_NAME ||
          tool.name === FILE_EDIT_TOOL_NAME ||
          tool.name === FILE_WRITE_TOOL_NAME) &&
        'file_path' in processedInput
      ) {
        fileExtension = getFileExtensionForAnalytics(
          String(processedInput.file_path),
        )
      } else if (
        tool.name === NOTEBOOK_EDIT_TOOL_NAME &&
        'notebook_path' in processedInput
      ) {
        fileExtension = getFileExtensionForAnalytics(
          String(processedInput.notebook_path),
        )
      } else if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
        const bashInput = processedInput as BashToolInput
        fileExtension = getFileExtensionsFromBashCommand(
          bashInput.command,
          bashInput._simulatedSedEdit?.filePath,
        )
      }
    }

    logEvent('tengu_tool_use_success', {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: tool.isMcp ?? false,
      durationMs,
      preToolHookDurationMs,
      toolResultSizeBytes,
      ...(fileExtension !== undefined && { fileExtension }),

      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
      ...(mcpServerType && {
        mcpServerType:
          mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(mcpServerBaseUrl && {
        mcpServerBaseUrl:
          mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(requestId && {
        requestId:
          requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
    })

    // Enrich tool parameters with git commit ID from successful git commit output
    if (
      isToolDetailsLoggingEnabled() &&
      (tool.name === BASH_TOOL_NAME || tool.name === POWERSHELL_TOOL_NAME) &&
      'command' in processedInput &&
      typeof processedInput.command === 'string' &&
      processedInput.command.match(/\bgit\s+commit\b/) &&
      result.data &&
      typeof result.data === 'object' &&
      'stdout' in result.data
    ) {
      const gitCommitId = parseGitCommitId(String(result.data.stdout))
      if (gitCommitId) {
        toolParameters.git_commit_id = gitCommitId
      }
    }

    // Log tool result event for OTLP with tool parameters and decision context
    const mcpServerScope = isMcpTool(tool)
      ? getMcpServerScopeFromToolName(tool.name)
      : null

    void logOTelEvent('tool_result', {
      tool_name: sanitizeToolNameForAnalytics(tool.name),
      tool_use_id: toolUseID,
      tool_source: tool.isMcp ? 'mcp' : tool.isLsp ? 'lsp' : 'built_in',
      ...(assistantMessage.uuid && {
        'message.uuid': assistantMessage.uuid,
      }),
      ...(requestId && { request_id: requestId }),
      ...(assistantMessage.clientRequestId && {
        client_request_id: assistantMessage.clientRequestId,
      }),
      success: 'true',
      duration_ms: String(durationMs),
      ...(Object.keys(toolParameters).length > 0 && {
        tool_parameters: jsonStringify(toolParameters),
      }),
      ...(telemetryToolInput && { tool_input: telemetryToolInput }),
      tool_result_size_bytes: String(toolResultSizeBytes),
      ...(decisionInfo && {
        decision_source: decisionInfo.source,
        decision_type: decisionInfo.decision,
      }),
      ...(mcpServerScope && { mcp_server_scope: mcpServerScope }),
    })

    // Run PostToolUse hooks
    let toolOutput = result.data
    const hookResults = []
    const toolContextModifier = result.contextModifier
    const mcpMeta = result.mcpMeta

    async function addToolResult(
      toolUseResult: unknown,
      preMappedBlock?: ToolResultBlockParam,
    ) {
      // Use the pre-mapped block when available (non-MCP tools where hooks
      // don't modify the output), otherwise map from scratch.
      const toolResultBlock = preMappedBlock
        ? await processPreMappedToolResultBlock(
            preMappedBlock,
            tool.name,
            tool.maxResultSizeChars,
          )
        : await processToolResultBlock(tool, toolUseResult, toolUseID)

      // Build content blocks - tool result first, then optional feedback
      const contentBlocks: ContentBlockParam[] = [toolResultBlock]
      // Add accept feedback if user provided feedback when approving
      // (acceptFeedback only exists on PermissionAllowDecision, which is guaranteed here)
      if (
        'acceptFeedback' in permissionDecision &&
        permissionDecision.acceptFeedback
      ) {
        contentBlocks.push({
          type: 'text',
          text: permissionDecision.acceptFeedback,
        })
      }

      // Add content blocks (e.g., pasted images) from the permission decision
      const allowContentBlocks =
        'contentBlocks' in permissionDecision
          ? permissionDecision.contentBlocks
          : undefined
      if (allowContentBlocks?.length) {
        contentBlocks.push(...allowContentBlocks)
      }

      // Generate sequential imagePasteIds so each image renders with a distinct label
      let allowImageIds: number[] | undefined
      if (allowContentBlocks?.length) {
        const imageCount = count(
          allowContentBlocks,
          (b: ContentBlockParam) => b.type === 'image',
        )
        if (imageCount > 0) {
          const startId = getNextImagePasteId(toolUseContext.messages)
          allowImageIds = Array.from(
            { length: imageCount },
            (_, i) => startId + i,
          )
        }
      }

      resultingMessages.push({
        message: createUserMessage({
          content: contentBlocks,
          imagePasteIds: allowImageIds,
          toolUseResult:
            toolUseContext.agentId && !toolUseContext.preserveToolUseResults
              ? undefined
              : toolUseResult,
          mcpMeta: toolUseContext.agentId ? undefined : mcpMeta,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
        contextModifier: toolContextModifier
          ? {
              toolUseID: toolUseID,
              modifyContext: toolContextModifier,
            }
          : undefined,
      })
    }

    // TOOD(hackyon): refactor so we don't have different experiences for MCP tools
    if (!isMcpTool(tool)) {
      await addToolResult(toolOutput, mappedToolResultBlock)
    }

    const postToolHookInfos: StopHookInfo[] = []
    const postToolHookStart = Date.now()
    for await (const hookResult of runPostToolUseHooks(
      toolUseContext,
      tool,
      toolUseID,
      messageId,
      processedInput,
      toolOutput,
      requestId,
      mcpServerType,
      mcpServerBaseUrl,
    )) {
      if ('updatedMCPToolOutput' in hookResult) {
        if (isMcpTool(tool)) {
          toolOutput = hookResult.updatedMCPToolOutput
        }
      } else if (isMcpTool(tool)) {
        hookResults.push(hookResult)
        if (hookResult.message.type === 'attachment') {
          const stopHookInfo = getStopHookInfo(
            hookResult.message.attachment,
          )
          if (stopHookInfo) postToolHookInfos.push(stopHookInfo)
        }
      } else {
        resultingMessages.push(hookResult)
        if (hookResult.message.type === 'attachment') {
          const stopHookInfo = getStopHookInfo(
            hookResult.message.attachment,
          )
          if (stopHookInfo) postToolHookInfos.push(stopHookInfo)
        }
      }
    }
    const postToolHookDurationMs = Date.now() - postToolHookStart
    if (postToolHookDurationMs >= SLOW_PHASE_LOG_THRESHOLD_MS) {
      logForDebugging(
        `Slow PostToolUse hooks: ${postToolHookDurationMs}ms for ${tool.name} (${postToolHookInfos.length} hooks)`,
        { level: 'info' },
      )
    }

    if (isMcpTool(tool)) {
      await addToolResult(toolOutput)
    }

    // Show PostToolUse hook timing inline below tool result when > 500ms.
    // Use wall-clock time (not sum of individual durations) since hooks run in parallel.
    if (process.env.USER_TYPE === 'ant' && postToolHookInfos.length > 0) {
      if (postToolHookDurationMs > HOOK_TIMING_DISPLAY_THRESHOLD_MS) {
        resultingMessages.push({
          message: createStopHookSummaryMessage(
            postToolHookInfos.length,
            postToolHookInfos,
            [],
            false,
            undefined,
            false,
            'suggestion',
            undefined,
            'PostToolUse',
            postToolHookDurationMs,
          ),
        })
      }
    }

    // If the tool provided new messages, add them to the list to return.
    if (result.newMessages && result.newMessages.length > 0) {
      for (const message of result.newMessages) {
        resultingMessages.push({ message })
      }
    }
    // If hook indicated to prevent continuation after successful execution, yield a stop reason message
    if (shouldPreventContinuation) {
      resultingMessages.push({
        message: createAttachmentMessage({
          type: 'hook_stopped_continuation',
          message: stopReason || 'Execution stopped by hook',
          hookName: `PreToolUse:${tool.name}`,
          toolUseID: toolUseID,
          hookEvent: 'PreToolUse',
        }),
      })
    }

    // Yield the remaining hook results after the other messages are sent
    for (const hookResult of hookResults) {
      resultingMessages.push(hookResult)
    }
    if (mappedToolResultBlock.is_error === true) {
      recordCallFailure(callSig)
    } else {
      recordCallSuccess(callSig)
    }
    return resultingMessages
  } catch (error) {
    const durationMs = Date.now() - startTime
    addToToolDuration(durationMs)

    endToolExecutionSpan({
      success: false,
      error: errorMessage(error),
    })
    endToolSpan()

    // Tool-specific circuit breakers use the same terminal abort type as the
    // generic guard. Preserve it through the inner execution boundary so the
    // outer query loop stops instead of converting it to another retryable
    // tool_result.
    if (error instanceof RepeatedToolFailureAbort) throw error

    // Handle MCP auth errors by updating the client status to 'needs-auth'
    // This updates the /mcp display to show the server needs re-authorization
    if (error instanceof McpAuthError) {
      toolUseContext.setAppState(prevState => {
        const serverName = error.serverName
        const existingClientIndex = prevState.mcp.clients.findIndex(
          c => c.name === serverName,
        )
        if (existingClientIndex === -1) {
          return prevState
        }
        const existingClient = prevState.mcp.clients[existingClientIndex]
        // Only update if client was connected (don't overwrite other states)
        if (!existingClient || existingClient.type !== 'connected') {
          return prevState
        }
        const updatedClients = [...prevState.mcp.clients]
        updatedClients[existingClientIndex] = {
          name: serverName,
          type: 'needs-auth' as const,
          config: existingClient.config,
        }
        return {
          ...prevState,
          mcp: {
            ...prevState.mcp,
            clients: updatedClients,
          },
        }
      })
    }

    if (!(error instanceof AbortError)) {
      recordCallFailure(callSig)
      const errorMsg = errorMessage(error)
      logForDebugging(
        `${tool.name} tool error (${durationMs}ms): ${errorMsg.slice(0, 200)}`,
      )
      if (!(error instanceof ShellError)) {
        logError(error)
      }
      logEvent('tengu_tool_use_error', {
        messageID:
          messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toolName: sanitizeToolNameForAnalytics(tool.name),
        error: classifyToolError(
          error,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        isMcp: tool.isMcp ?? false,

        queryChainId: toolUseContext.queryTracking
          ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        queryDepth: toolUseContext.queryTracking?.depth,
        ...(mcpServerType && {
          mcpServerType:
            mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(mcpServerBaseUrl && {
          mcpServerBaseUrl:
            mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(requestId && {
          requestId:
            requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...mcpToolDetailsForAnalytics(
          tool.name,
          mcpServerType,
          mcpServerBaseUrl,
        ),
      })
      // Log tool result error event for OTLP with tool parameters and decision context
      const mcpServerScope = isMcpTool(tool)
        ? getMcpServerScopeFromToolName(tool.name)
        : null

      void logOTelEvent('tool_result', {
        tool_name: sanitizeToolNameForAnalytics(tool.name),
        tool_use_id: toolUseID,
        tool_source: tool.isMcp ? 'mcp' : tool.isLsp ? 'lsp' : 'built_in',
        ...(assistantMessage.uuid && {
          'message.uuid': assistantMessage.uuid,
        }),
        ...(requestId && { request_id: requestId }),
        ...(assistantMessage.clientRequestId && {
          client_request_id: assistantMessage.clientRequestId,
        }),
        success: 'false',
        duration_ms: String(durationMs),
        error: errorMessage(error),
        ...(Object.keys(toolParameters).length > 0 && {
          tool_parameters: jsonStringify(toolParameters),
        }),
        ...(telemetryToolInput && { tool_input: telemetryToolInput }),
        ...(decisionInfo && {
          decision_source: decisionInfo.source,
          decision_type: decisionInfo.decision,
        }),
        ...(mcpServerScope && { mcp_server_scope: mcpServerScope }),
      })
    }
    const content = formatError(error)

    // Determine if this was a user interrupt
    const isInterrupt = error instanceof AbortError

    // Run OnFailure hooks
    void executeOnFailureHooks(content, 'tool', toolUseContext, {
      toolName: tool.name,
      toolUseID,
    }).then(({ memory }) => {
      if (memory) {
        appendProjectMemory(getCwd(), memory.kind, memory.text, {
          rationale: memory.rationale,
          scope: memory.scope,
          source: 'OnFailure hook',
        })
      }
    })

    // Run PostToolUseFailure hooks
    const hookMessages: MessageUpdateLazy<
      AttachmentMessage | ProgressMessage<HookProgress>
    >[] = []
    for await (const hookResult of runPostToolUseFailureHooks(
      toolUseContext,
      tool,
      toolUseID,
      messageId,
      processedInput,
      content,
      isInterrupt,
      requestId,
      mcpServerType,
      mcpServerBaseUrl,
    )) {
      hookMessages.push(hookResult)
    }

    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `Error: ${content}`,
          mcpMeta: toolUseContext.agentId
            ? undefined
            : error instanceof
                McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
              ? error.mcpMeta
              : undefined,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
      ...hookMessages,
    ]
  } finally {
    stopSessionActivity('tool_exec')
    // Clean up decision info after logging
    if (decisionInfo) {
      toolUseContext.toolDecisions?.delete(toolUseID)
    }
  }
}
