// Reconstructed permissive SDK core types.
// The leaked source stubbed the generated file; these definitions match the
// observed usage so consumers compile without runtime change.

type AnyObject = Record<string, any>

export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

export type OutputFormatType = 'json_schema'

export type BaseOutputFormat = {
  type: OutputFormatType
}

export type JsonSchemaOutputFormat = {
  type: 'json_schema'
  schema: Record<string, unknown>
}

export type OutputFormat = JsonSchemaOutputFormat

export type ApiKeySource = 'user' | 'project' | 'org' | 'temporary' | 'oauth'
export type ConfigScope = 'local' | 'user' | 'project'

export type SdkBeta = 'context-1m-2025-08-07'

export type ThinkingAdaptive = { type: 'adaptive' }
export type ThinkingEnabled = { type: 'enabled'; budgetTokens?: number }
export type ThinkingDisabled = { type: 'disabled' }
export type ThinkingConfig = ThinkingAdaptive | ThinkingEnabled | ThinkingDisabled

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'

export type HookEventName = string
export type HookEvent = HookEventName

export type SDKExitReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'other'
  | 'bypass_permissions_disabled'

export type SDKMessageBase = {
  type?: string
  uuid?: string
  session_id?: string
  parent_tool_use_id?: string | null
  [key: string]: unknown
}

export type SDKUserMessage = SDKMessageBase & {
  type: 'user'
  message: AnyObject
}

export type SDKAssistantMessage = SDKMessageBase & {
  type: 'assistant'
  message: AnyObject
}

export type SDKAssistantMessageError = SDKMessageBase & {
  type: 'assistant'
  subtype: 'error'
  error: { message: string; type?: string }
}

export type SDKSystemMessage = SDKMessageBase & {
  type: 'system'
  subtype?: string
}

export type SDKResultSuccess = SDKMessageBase & {
  type: 'result'
  subtype: 'success'
  result: string
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  is_error: boolean
  session_id: string
  total_cost_usd?: number
  usage?: ModelUsage
  stop_reason?: string | null
  [key: string]: any
}

export type SDKResultError = SDKMessageBase & {
  type: 'result'
  subtype:
    | 'error_max_turns'
    | 'error_during_execution'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries'
    | 'error'
  is_error: boolean
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  session_id: string
  result?: string
  stop_reason?: string
  errors?: string[]
  [key: string]: any
}

export type SDKResultMessage = SDKResultSuccess | SDKResultError

export type SDKCompactBoundaryMessage = SDKMessageBase & {
  type: 'system'
  subtype: 'compact_boundary'
  trigger?: 'manual' | 'auto'
  pre_tokens?: number
  compact_metadata?: AnyObject
}

export type SDKPermissionDenial = {
  tool_name?: string
  tool_input?: AnyObject
  reason?: string
  [key: string]: any
}

export type SDKStatus =
  | string
  | {
      status?: string
      message?: string
      [key: string]: any
    }

export type SDKUserMessageReplay = SDKMessageBase & {
  type: 'user'
  message: AnyObject
  isReplay?: boolean
  isSynthetic?: boolean
  [key: string]: any
}

export type SDKStreamEventMessage = SDKMessageBase & {
  type: 'stream_event'
  event?: any
}

export type SDKToolUseSummaryMessage = SDKMessageBase & {
  type: 'tool_use_summary'
  tool_use_id?: string
  summary?: string
}

export type SDKMessage =
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKAssistantMessage
  | SDKAssistantMessageError
  | SDKSystemMessage
  | SDKCompactBoundaryMessage
  | SDKResultMessage
  | SDKStreamEventMessage
  | SDKToolUseSummaryMessage

export type SDKSessionInfo = {
  session_id: string
  uuid?: string
  created_at?: string
  updated_at?: string
  cwd?: string
  model?: string
  title?: string
  [key: string]: unknown
}

export type SDKSession = SDKSessionInfo & {
  messages?: SDKMessage[]
}

// Hook input/output types — permissive bags keyed by hook event.
export interface HookInputBase {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  [key: string]: any
}

export type HookInput = HookInputBase
export type NotificationHookInput = HookInputBase
export type PreToolUseHookInput = HookInputBase
export type PostToolUseHookInput = HookInputBase
export type PostToolUseFailureHookInput = HookInputBase
export type PermissionDeniedHookInput = HookInputBase
export type PermissionRequestHookInput = HookInputBase
export type PreCompactHookInput = HookInputBase
export type PostCompactHookInput = HookInputBase
export type SessionStartHookInput = HookInputBase
export type SessionEndHookInput = HookInputBase
export type SetupHookInput = HookInputBase
export type StopHookInput = HookInputBase
export type StopFailureHookInput = HookInputBase
export type SubagentStartHookInput = HookInputBase
export type SubagentStopHookInput = HookInputBase
export type TeammateIdleHookInput = HookInputBase
export type TaskCreatedHookInput = HookInputBase
export type TaskCompletedHookInput = HookInputBase
export type ConfigChangeHookInput = HookInputBase
export type ElicitationHookInput = HookInputBase
export type ElicitationResultHookInput = HookInputBase
export type WorktreeCreateHookInput = HookInputBase
export type WorktreeRemoveHookInput = HookInputBase
export type InstructionsLoadedHookInput = HookInputBase
export type CwdChangedHookInput = HookInputBase
export type FileChangedHookInput = HookInputBase
export type UserPromptSubmitHookInput = HookInputBase

export interface HookJSONOutput {
  decision?: 'approve' | 'block' | 'allow' | 'deny' | string
  reason?: string
  systemMessage?: string
  hookSpecificOutput?: AnyObject
  continue?: boolean
  stopReason?: string
  suppressOutput?: boolean
  [key: string]: any
}

export type SyncHookJSONOutput = HookJSONOutput & { async?: false | undefined; [key: string]: any }
export type AsyncHookJSONOutput = HookJSONOutput & { async: true; [key: string]: any }

export type ExitReason = SDKExitReason

export interface PermissionUpdate {
  type?: string
  rules?: AnyObject[]
  scope?: string
  [key: string]: any
}

// Catch-all permissive aliases used by various SDK callsites.
export type SDKOptions = AnyObject
export type SDKConfig = AnyObject
export type SDKQueryOptions = AnyObject
export type SDKQueryResult = AnyObject
export type SDKQuery = AnyObject
