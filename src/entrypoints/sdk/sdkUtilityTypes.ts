// NonNullableUsage mirrors the BetaUsage shape with all fields non-nullable
// (the conversation manager expects every counter to be present, not null).

export interface NonNullableUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  server_tool_use?: {
    web_search_requests: number
    web_fetch_requests: number
  }
  service_tier?: string | null
  cache_creation?: {
    ephemeral_1h_input_tokens: number
    ephemeral_5m_input_tokens: number
  }
  [key: string]: any
}
