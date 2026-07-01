export type AcpMethod =
  | 'initialize'
  | 'session/new'
  | 'session/prompt'
  | 'session/cancel'
  | 'tools/list'
  | 'tools/call'
  | 'tasks/send'
  | 'tasks/get'
  | 'tasks/cancel'
  | 'ide/diffCapture'
  | 'ide/select'
  | 'shutdown'

export type AcpCapabilities = {
  tools: boolean
  tasks: boolean
  sessions: boolean
  ide: boolean
  streaming: boolean
  cancellation: boolean
}

export type AcpInitializeResult = {
  name: string
  version: string
  protocolVersion: string
  workspaceRoot: string
  capabilities: AcpCapabilities
}

export type AcpRequest = {
  jsonrpc: '2.0'
  id: string | number | null
  method: AcpMethod
  params?: Record<string, unknown>
}

export type AcpError = {
  code: number
  message: string
  data?: unknown
}

export type AcpResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: AcpError
}

export type AcpToolInfo = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type AcpTaskStatus =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled'

export type AcpTaskRecord = {
  id: string
  prompt?: string
  tool?: string
  backgroundTaskId?: string
  status: AcpTaskStatus
  mode: 'sync' | 'async'
  createdAt: string
  updatedAt: string
  result?: unknown
  error?: string
}

export type AcpServeOptions = {
  host: string
  port: number
  token?: string
  cwd: string
  dryRun?: boolean
  debug?: boolean
}
