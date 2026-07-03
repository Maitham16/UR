// Reconstructed tool progress types for the subset of leaked-source runtime
// renderers included in this distribution.
import type {
  NormalizedUserMessage,
  NormalizedMessage,
} from './message.js'

type ShellProgressFields = {
  output?: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes?: number
  taskId?: string
  timeoutMs?: number
}

type ProgressBackedMessage = NormalizedMessage

export interface AgentToolProgress {
  message: ProgressBackedMessage
  prompt?: string
  agentId?: string
}
export interface BashProgress extends ShellProgressFields {
  type?: 'bash_progress'
}
export interface MCPProgress {
  progress?: number
  total?: number
  progressMessage?: string
}
export interface PowerShellProgress extends ShellProgressFields {
  type?: 'powershell_progress'
}
export interface REPLToolProgress {}
export interface SdkWorkflowProgress {}
export interface ShellProgress {}
export interface SkillToolProgress {
  type?: 'skill_progress'
  message: ProgressBackedMessage
  prompt?: string
  agentId?: string
}
export interface TaskOutputProgress {}
export interface ToolProgressData {}
export type WebSearchProgress =
  | { type: 'query_update'; query: string }
  | { type: 'search_results_received'; query: string; resultCount: number }
