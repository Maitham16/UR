type JsonObject = Record<string, any>

export type SDKControlCancelRequest = JsonObject & {
  type: 'control_cancel'
  request_id?: string
}

export type SDKControlInitializeRequest = JsonObject & {
  subtype: 'initialize'
}

export type SDKControlInitializeResponse = JsonObject

export type SDKControlMcpSetServersResponse = JsonObject & {
  servers?: unknown[]
}

export type SDKControlPermissionRequest = JsonObject & {
  subtype?: string
  tool_use_id?: string
}

export type SDKControlReloadPluginsResponse = JsonObject & {
  plugins?: unknown[]
}

export type SDKControlRequestInner = JsonObject & {
  subtype?: string
}

export type SDKControlRequest = JsonObject & {
  type: 'control_request'
  request_id: string
  request: SDKControlRequestInner
}

export type SDKControlResponse = JsonObject & {
  type: 'control_response'
  request_id?: string
  response?: unknown
}

export type SDKPartialAssistantMessage = JsonObject & {
  type: 'stream_event'
  event: any
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
}

export type StdinMessage = JsonObject & {
  type: string
}

type AssistantStdoutMessage = JsonObject & {
  type: 'assistant'
  message: {
    id: string
    content?: unknown
    stop_reason?: unknown
  }
  parent_tool_use_id: string | null
  session_id: string
}

type GenericStdoutMessage = JsonObject & {
  type:
    | 'control_cancel'
    | 'control_request'
    | 'control_response'
    | 'keep_alive'
    | 'post_turn_summary'
    | 'result'
    | 'streamlined_text'
    | 'streamlined_tool_use_summary'
    | 'system'
    | 'user'
}

export type StdoutMessage =
  | SDKPartialAssistantMessage
  | AssistantStdoutMessage
  | GenericStdoutMessage
