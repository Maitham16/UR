// Reconstructed Message type definitions.
// Permissive shapes capturing the union of fields observed across the codebase.
// Runtime behavior is unchanged; these types only feed the typechecker.

import type {
  BetaMessage,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'

type AnyObject = Record<string, any>

export interface InnerMessage {
  id?: string
  type?: string
  role?: string
  model?: string
  content?: any
  stop_reason?: any
  stop_sequence?: any
  usage?: any
  context_management?: any
  [key: string]: any
}

export interface MessageOrigin {
  kind?: string
  server?: string
  source?: string
  [key: string]: unknown
}

export interface CompactMetadata {
  trigger?: string
  preTokens?: number
  preservedSegment?: unknown
  direction?: string
  messagesSummarized?: number
  userContext?: string
  [key: string]: unknown
}

export interface BaseMessage {
  type?: string
  uuid?: string
  message?: InnerMessage
  isMeta?: boolean
  isVirtual?: boolean
  isApiErrorMessage?: boolean
  isCompactSummary?: boolean
  isVisibleInTranscriptOnly?: boolean
  toolUseResult?: unknown
  toolUseID?: string
  parentToolUseID?: string
  sourceToolUseID?: string
  origin?: MessageOrigin | string
  timestamp?: number | string
  requestId?: string
  subtype?: string
  apiError?: any
  errorDetails?: string
  error?: any
  research?: unknown
  compactMetadata?: CompactMetadata
  mcpMeta?: AnyObject
  permissionMode?: string
  planContent?: string
  advisorModel?: string
  durationMs?: number
  costUSD?: number
  model?: string
  usage?: BetaUsage
  content?: string | ContentBlockParam[]
  attachment?: any
  data?: any
  hookLabel?: string
  relevantMemories?: unknown
  messageCount?: number
  imagePasteIds?: any
  sourceToolAssistantUUID?: any
  summarizeMetadata?: any
  [key: string]: any
}

export interface UserMessage extends BaseMessage {
  type?: 'user'
}

export interface AssistantMessage extends BaseMessage {
  type?: 'assistant'
}

export interface AttachmentMessage<A = unknown> extends BaseMessage {
  type?: 'attachment'
  attachment?: A
}

export interface ProgressMessage<P = unknown> extends BaseMessage {
  type?: 'progress'
  data?: P
}

export interface SystemMessage extends BaseMessage {
  type?: 'system'
  subtype?: string
}

export interface SystemAPIErrorMessage extends SystemMessage {
  subtype?: 'apiError' | 'api_error'
}

export interface SystemAgentsKilledMessage extends SystemMessage {}
export interface SystemAwaySummaryMessage extends SystemMessage {}
export interface SystemBridgeStatusMessage extends SystemMessage {}

export interface SystemCompactBoundaryMessage extends SystemMessage {
  compactMetadata?: CompactMetadata
}

export interface SystemFileSnapshotMessage extends SystemMessage {
  snapshotFiles?: unknown
}

export interface SystemInformationalMessage extends SystemMessage {}
export interface SystemLocalCommandMessage extends SystemMessage {}

export interface SystemMemorySavedMessage extends SystemMessage {
  teamCount?: number
}

export type SystemMessageLevel = string

export interface SystemMicrocompactBoundaryMessage extends SystemMessage {}
export interface SystemPermissionRetryMessage extends SystemMessage {}
export interface SystemScheduledTaskFireMessage extends SystemMessage {}

export interface SystemStopHookSummaryMessage extends SystemMessage {
  hookCount?: number
  hookErrors?: unknown
  hookInfos?: unknown
  hasOutput?: boolean
  totalDurationMs?: number
  preventedContinuation?: boolean
}

export interface SystemApiMetricsMessage extends SystemMessage {}
export interface SystemThinkingMessage extends SystemMessage {}
export interface SystemTurnDurationMessage extends SystemMessage {}

export interface HookResultMessage extends BaseMessage {
  toolUseID?: string
  data?: unknown
  attachment?: unknown
}

export interface StopHookInfo {
  command?: string
  durationMs?: number
  [key: string]: unknown
}

export interface TombstoneMessage extends BaseMessage {
  type?: 'tombstone'
}

export interface ToolUseSummaryMessage extends BaseMessage {}

export interface CollapsibleMessage extends BaseMessage {
  toolUseResult?: unknown
}

export interface CollapsedReadSearchGroup {
  bashCount?: number
  branches?: unknown
  commits?: unknown
  displayMessage?: string
  gitOpBashCount?: number
  hookCount?: number
  hookInfos?: unknown
  hookTotalMs?: number
  latestDisplayHint?: string
  listCount?: number
  mcpCallCount?: number
  mcpServerNames?: string[]
  memoryReadCount?: number
  memorySearchCount?: number
  memoryWriteCount?: number
  messages?: BaseMessage[]
  prs?: unknown
  pushes?: unknown
  readCount?: number
  readFilePaths?: string[]
  relevantMemories?: unknown
  replCount?: number
  searchArgs?: unknown
  searchCount?: number
  teamMemoryReadCount?: number
  teamMemorySearchCount?: number
  teamMemoryWriteCount?: number
  type?: string
  [key: string]: unknown
}

export interface GroupedToolUseMessage extends BaseMessage {
  messages?: BaseMessage[]
  results?: unknown
  toolName?: string
}

export interface NormalizedMessage extends BaseMessage {
  sourceToolUseID?: string
}

export interface NormalizedAssistantMessage<_C = any> extends AssistantMessage {
  mcpMeta?: AnyObject
}

export interface NormalizedUserMessage extends UserMessage {}

export interface RenderableMessage extends BaseMessage {
  hookLabel?: string
  messages?: BaseMessage[]
  relevantMemories?: unknown
  results?: unknown
  toolName?: string
}

export interface RequestStartEvent {
  type?: string
  requestId?: string
  model?: string
  [key: string]: unknown
}

export interface StreamEvent {
  type?: string
  event?: any
  [key: string]: any
}

export type PartialCompactDirection = 'up_to' | 'from' | string

// Permissive Message union — accepts any of the concrete variants.
export interface Message extends BaseMessage {}
