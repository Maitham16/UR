// Shared bridge types. Mirrors src/services/agents/ideDiffs.ts (IdeDiffBundle)
// so the extension never invents its own status vocabulary.

export type IdeDiffStatus = 'pending' | 'commented' | 'approved' | 'rejected'

export interface DiffComment {
  at: string
  file?: string
  line?: number
  text: string
}

export interface DiffFileChange {
  path: string
  additions: number
  deletions: number
}

/** 1:1 with IdeDiffBundle in src/services/agents/ideDiffs.ts. */
export interface DiffArtifact {
  id: string
  title: string
  status: IdeDiffStatus
  baseRef?: string
  staged?: boolean
  patchFile: string
  metadataFile: string
  files: DiffFileChange[]
  comments: DiffComment[]
  createdAt: string
  updatedAt: string
}

export interface DiffManifest {
  version: number
  diffs: DiffArtifact[]
}

// ---------------------------------------------------------------------------
// Agent status card. Assembled from two existing CLI JSON surfaces
// (`ur ide status --json`, `ur provider status --json`) plus `ur --version`
// — see status/statusData.ts. Every capability field is a real value from
// those surfaces, or the literal string 'unknown' when the surface doesn't
// expose it. Nothing here is guessed.
// ---------------------------------------------------------------------------

export type KnownOrUnknown<T> = T | 'unknown'

export interface AgentStatus {
  urVersion: string
  workspaceRoot: string
  acp: { running: boolean; port: number | null; host: string }
  provider: {
    label: string
    model?: string
    providerKind: KnownOrUnknown<'ur-native' | 'subscription-cli' | 'subscription-placeholder'>
    usesExternalCli: KnownOrUnknown<boolean>
    supportsNativeToolCalls: KnownOrUnknown<boolean>
    supportsNativeStreaming: KnownOrUnknown<boolean>
    multimodal: KnownOrUnknown<boolean>
    safetyBoundaryLabel?: string
  }
  sandboxMode: KnownOrUnknown<'disabled' | 'recommended' | 'required'>
  verifierMode: KnownOrUnknown<'off' | 'loose' | 'strict'>
  pluginCount: number
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Actions panel: background tasks, read from the existing `ur bg list --json`
// surface. Diff bundles reuse DiffArtifact above (same .ur/ide/diffs store).
// ---------------------------------------------------------------------------

export type BackgroundTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

export interface BackgroundTaskSummary {
  id: string
  task: string
  status: BackgroundTaskStatus
  logFile: string
}

// ---------------------------------------------------------------------------
// Agent Options panel: local/curated recommendations layered on top of the
// real `ur provider list --json` surface. See options/agentOptions.ts.
// ---------------------------------------------------------------------------

export type ProviderKindValue = 'ur-native' | 'subscription-cli' | 'subscription-placeholder'
export type ProviderAccessTypeValue = 'subscription' | 'api' | 'local' | 'server'

/** One entry from `ur provider list --json`, narrowed to the fields the
 * Agent Options panel reasons about, plus the extension's own curated
 * multimodal derivation (not present in the CLI's JSON). */
export interface ProviderOption {
  id: string
  displayName: string
  providerKind: ProviderKindValue
  accessType: ProviderAccessTypeValue
  usesExternalCli: boolean
  supportsNativeToolCalls: boolean
  supportsNativeStreaming: boolean
  multimodal: KnownOrUnknown<boolean>
  safetyBoundaryLabel: string
}

export type RecommendationCategory =
  | 'privacy'
  | 'speed'
  | 'multimodal'
  | 'tool-calling'
  | 'native-streaming'
  | 'subscription-cli-access'
  | 'local-offline'
  | 'complex-refactor'
  | 'docs-review'

export interface CategoryRecommendation {
  category: RecommendationCategory
  title: string
  rationale: string
  recommendedProviderIds: string[]
  caveat?: string
}

// ---------------------------------------------------------------------------
// `ur -p --output-format stream-json --verbose --permission-prompt-tool stdio`
// wire contract. Field names match the CLI's NDJSON envelope exactly (see
// src/cli/structuredIO.ts and src/entrypoints/sdk/controlTypes.ts) — this is
// not a re-invented shape, it is the on-the-wire shape.
// ---------------------------------------------------------------------------

/** One parsed NDJSON line. Deliberately loose — the CLI's own union is large
 * and this client only special-cases a few `type` values (see urProcess.ts). */
export interface StdoutMessage {
  type: string
  [key: string]: unknown
}

export interface ControlRequestEnvelope extends StdoutMessage {
  type: 'control_request'
  request_id: string
  request: {
    subtype: string
    tool_name?: string
    input?: Record<string, unknown>
    tool_use_id?: string
    [key: string]: unknown
  }
}

export interface ControlCancelRequestEnvelope extends StdoutMessage {
  type: 'control_cancel_request'
  request_id: string
}

export function isControlRequest(message: StdoutMessage): message is ControlRequestEnvelope {
  return message.type === 'control_request' && typeof message.request_id === 'string'
}

export function isControlCancelRequest(message: StdoutMessage): message is ControlCancelRequestEnvelope {
  return message.type === 'control_cancel_request' && typeof message.request_id === 'string'
}

export function isCanUseToolRequest(message: ControlRequestEnvelope): boolean {
  return message.request?.subtype === 'can_use_tool'
}

/** What the extension writes back to the child's stdin. Matches the Zod
 * schema in src/utils/permissions/PermissionPromptToolResultSchema.ts. */
export type PermissionDecision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

// ---------------------------------------------------------------------------
// Chat session/message model, persisted by sessions/sessionStore.ts.
// ---------------------------------------------------------------------------

export type ChatRole = 'user' | 'assistant' | 'status'

export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; summary: string }
  | { type: 'permission_request'; requestId: string; toolName: string; resolved?: 'allow' | 'deny' }

export interface ChatMessage {
  id: string
  sessionId: string
  role: ChatRole
  content: ChatContentBlock[]
  createdAt: string
}

/** `id` is the extension's own local storage key (stable for the session's
 * lifetime). `cliSessionId` is only known once the CLI's first `system/init`
 * message arrives and is what gets passed to `--resume` — the two are kept
 * distinct so a freshly created session never guesses at an unseen CLI id. */
export interface ChatSession {
  id: string
  cliSessionId?: string
  title: string
  workspaceRoot: string
  createdAt: string
  updatedAt: string
  archived?: boolean
}

export interface ChatSessionRecord {
  session: ChatSession
  messages: ChatMessage[]
}
