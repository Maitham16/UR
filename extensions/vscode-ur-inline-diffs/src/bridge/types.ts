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

/**
 * Placeholder only for this PR. The full status card (acp, provider,
 * sandbox/verifier mode, warnings) lands with the agent identity panel.
 */
export interface AgentStatus {
  workspaceRoot: string
  raw: string
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
