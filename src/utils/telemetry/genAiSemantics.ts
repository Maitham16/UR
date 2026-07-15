import {
  metrics,
  type Attributes,
  type Histogram,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import { isEnvTruthy } from '../envUtils.js'

export const GEN_AI_OPERATION_CHAT = 'chat'
export const GEN_AI_OPERATION_INVOKE_AGENT = 'invoke_agent'
export const GEN_AI_OPERATION_INVOKE_WORKFLOW = 'invoke_workflow'
export const GEN_AI_OPERATION_EXECUTE_TOOL = 'execute_tool'

export type GenAiMemoryOperation =
  | 'create_memory_store'
  | 'search_memory'
  | 'create_memory'
  | 'update_memory'
  | 'upsert_memory'
  | 'delete_memory'
  | 'delete_memory_store'

const MAX_CONTENT_ATTRIBUTE_LENGTH = 60 * 1024
const LOW_CARDINALITY_VALUE = /^[a-zA-Z0-9._:/-]{1,128}$/

type GenAiInstruments = {
  operationDuration: Histogram
  timeToFirstChunk: Histogram
  timePerOutputChunk: Histogram
  tokenUsage: Histogram
  agentDuration: Histogram
  toolDuration: Histogram
}

let instruments: GenAiInstruments | undefined

function getInstruments(): GenAiInstruments {
  if (instruments) return instruments
  const meter = metrics.getMeter('ur-agent.gen_ai', MACRO.VERSION)
  instruments = {
    operationDuration: meter.createHistogram('gen_ai.client.operation.duration', {
      description: 'GenAI operation duration.',
      unit: 's',
    }),
    timeToFirstChunk: meter.createHistogram(
      'gen_ai.client.operation.time_to_first_chunk',
      {
        description:
          'Time to receive the first chunk, measured from when the client issues the generation request to when the first chunk is received in the response stream.',
        unit: 's',
      },
    ),
    timePerOutputChunk: meter.createHistogram(
      'gen_ai.client.operation.time_per_output_chunk',
      {
        description:
          'Time per output chunk, recorded for each chunk received after the first one, measured as the time elapsed from the end of the previous chunk to the end of the current chunk.',
        unit: 's',
      },
    ),
    tokenUsage: meter.createHistogram('gen_ai.client.token.usage', {
      description: 'Number of input and output tokens used.',
      unit: '{token}',
    }),
    agentDuration: meter.createHistogram('gen_ai.invoke_agent.duration', {
      description: 'End-to-end duration of an in-process agent invocation.',
      unit: 's',
    }),
    toolDuration: meter.createHistogram('gen_ai.execute_tool.duration', {
      description: 'Duration of a single tool execution.',
      unit: 's',
    }),
  }
  return instruments
}

function finiteNonNegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0
}

function finitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}

function boundedLowCardinality(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && LOW_CARDINALITY_VALUE.test(normalized)
    ? normalized
    : undefined
}

/**
 * Resolve a provider without inspecting credentials or URLs. Operators can set
 * UR_OTEL_GENAI_PROVIDER when a gateway obscures the upstream provider.
 */
export function resolveGenAiProvider(model: string): string {
  const explicit = boundedLowCardinality(process.env.UR_OTEL_GENAI_PROVIDER)
  if (explicit) return explicit

  const value = model.toLowerCase()
  if (/^(claude|anthropic[/:])/.test(value)) return 'anthropic'
  if (/^(gpt-|o[134](?:-|$)|chatgpt|codex|openai[/:])/.test(value)) {
    return 'openai'
  }
  if (/^(gemini|google[/:])/.test(value)) return 'gcp.gemini'
  if (/^(deepseek|deepseek[/:])/.test(value)) return 'deepseek'
  if (/^(mistral|codestral|ministral)/.test(value)) return 'mistral_ai'
  if (/^(grok|x-ai|xai[/:])/.test(value)) return 'x_ai'
  if (/^(command-r|cohere[/:])/.test(value)) return 'cohere'
  if (/^groq[/:]/.test(value)) return 'groq'
  return 'ur'
}

export function shouldCaptureGenAiContent(): boolean {
  return isEnvTruthy(
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
  )
}

export function truncateGenAiContent(value: string): string {
  if (value.length <= MAX_CONTENT_ATTRIBUTE_LENGTH) return value
  return `${value.slice(0, MAX_CONTENT_ATTRIBUTE_LENGTH)}\n[TRUNCATED]`
}

export function genAiInferenceAttributes(
  model: string,
  options: {
    stream?: boolean
    provider?: string
    conversationId?: string
    serverAddress?: string
    serverPort?: number
  } = {},
): Attributes {
  const provider =
    boundedLowCardinality(options.provider) ?? resolveGenAiProvider(model)
  const attributes: Attributes = {
    'gen_ai.operation.name': GEN_AI_OPERATION_CHAT,
    'gen_ai.provider.name': provider,
    'gen_ai.request.model': model,
  }
  if (options.stream !== undefined) {
    attributes['gen_ai.request.stream'] = options.stream
  }
  if (options.conversationId) {
    attributes['gen_ai.conversation.id'] = options.conversationId
  }
  if (options.serverAddress) {
    attributes['server.address'] = options.serverAddress
    if (
      options.serverPort !== undefined &&
      Number.isInteger(options.serverPort) &&
      options.serverPort > 0 &&
      options.serverPort <= 65535
    ) {
      attributes['server.port'] = options.serverPort
    }
  }
  return attributes
}

export function genAiAgentAttributes(): Attributes {
  return {
    'gen_ai.operation.name': GEN_AI_OPERATION_INVOKE_AGENT,
    'gen_ai.provider.name': 'ur',
    'gen_ai.agent.name': 'UR-Nexus',
    'gen_ai.agent.version': MACRO.VERSION,
  }
}

export function genAiWorkflowAttributes(workflowName?: string): Attributes {
  const attributes: Attributes = {
    'gen_ai.operation.name': GEN_AI_OPERATION_INVOKE_WORKFLOW,
  }
  const normalized = workflowName?.trim()
  if (
    normalized &&
    normalized.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    attributes['gen_ai.workflow.name'] = normalized
  }
  return attributes
}

export function startGenAiWorkflowSpan(workflowName?: string): Span {
  const attributes = genAiWorkflowAttributes(workflowName)
  const name =
    typeof attributes['gen_ai.workflow.name'] === 'string'
      ? `invoke_workflow ${attributes['gen_ai.workflow.name']}`
      : GEN_AI_OPERATION_INVOKE_WORKFLOW
  return trace
    .getTracer('ur-agent.gen_ai', MACRO.VERSION)
    .startSpan(name, { kind: SpanKind.INTERNAL, attributes })
}

export function endGenAiWorkflowSpan(
  span: Span,
  options: { errorType?: string } = {},
): void {
  try {
    if (options.errorType) {
      span.setAttribute('error.type', options.errorType)
      span.setStatus({ code: SpanStatusCode.ERROR })
    } else {
      span.setStatus({ code: SpanStatusCode.OK })
    }
  } catch {
    // Telemetry must never change workflow execution semantics.
  } finally {
    try {
      span.end()
    } catch {
      // A third-party exporter or span implementation may be faulty.
    }
  }
}

export function genAiToolAttributes(
  toolName: string,
  options: { callId?: string; toolType?: string } = {},
): Attributes {
  const normalizedName = toolName.trim().slice(0, 128) || 'unknown'
  const attributes: Attributes = {
    'gen_ai.operation.name': GEN_AI_OPERATION_EXECUTE_TOOL,
    'gen_ai.tool.name': normalizedName,
  }
  if (options.callId) attributes['gen_ai.tool.call.id'] = options.callId
  if (boundedLowCardinality(options.toolType)) {
    attributes['gen_ai.tool.type'] = options.toolType
  }
  return attributes
}

export function startGenAiMemorySpan(
  operation: GenAiMemoryOperation,
  options: { storeId?: string; recordId?: string; recordCount?: number } = {},
): Span {
  const attributes: Attributes = { 'gen_ai.operation.name': operation }
  if (options.storeId) attributes['gen_ai.memory.store.id'] = options.storeId
  if (options.recordId) attributes['gen_ai.memory.record.id'] = options.recordId
  if (
    options.recordCount !== undefined &&
    Number.isInteger(options.recordCount) &&
    options.recordCount >= 0
  ) {
    attributes['gen_ai.memory.record.count'] = options.recordCount
  }
  return trace
    .getTracer('ur-agent.gen_ai', MACRO.VERSION)
    .startSpan(operation, { kind: SpanKind.INTERNAL, attributes })
}

export function endGenAiMemorySpan(
  span: Span,
  options: {
    recordId?: string
    recordCount?: number
    records?: unknown
    error?: unknown
  } = {},
): void {
  try {
    if (options.recordId) {
      span.setAttribute('gen_ai.memory.record.id', options.recordId)
    }
    if (
      options.recordCount !== undefined &&
      Number.isInteger(options.recordCount) &&
      options.recordCount >= 0
    ) {
      span.setAttribute('gen_ai.memory.record.count', options.recordCount)
    }
    if (options.records !== undefined && shouldCaptureGenAiContent()) {
      try {
        span.setAttribute(
          'gen_ai.memory.records',
          truncateGenAiContent(JSON.stringify(options.records)),
        )
      } catch {
        // Instrumentation must never break the memory operation.
      }
    }
    if (options.error !== undefined) {
      const message =
        options.error instanceof Error
          ? options.error.message
          : String(options.error)
      span.setAttribute(
        'error.type',
        classifyGenAiError({ error: message }) ?? '_OTHER',
      )
      span.setStatus({ code: SpanStatusCode.ERROR })
    } else {
      span.setStatus({ code: SpanStatusCode.OK })
    }
  } catch {
    // Observability is best effort and must never change memory semantics.
  } finally {
    try {
      span.end()
    } catch {
      // A misconfigured or third-party exporter must not break memory I/O.
    }
  }
}

export function classifyGenAiError(options: {
  statusCode?: number
  error?: string
}): string | undefined {
  if (options.statusCode !== undefined && Number.isInteger(options.statusCode)) {
    return String(options.statusCode)
  }
  const error = options.error?.toLowerCase()
  if (!error) return undefined
  if (/timeout|timed out/.test(error)) return 'timeout'
  if (/abort|cancel/.test(error)) return 'cancelled'
  if (/rate.?limit|too many requests/.test(error)) return 'rate_limit_exceeded'
  if (/unauthori[sz]ed|authentication|api key/.test(error)) {
    return 'authentication_error'
  }
  if (/connection|network|socket|dns|fetch failed/.test(error)) {
    return 'network_error'
  }
  return '_OTHER'
}

export function recordGenAiClientMetrics(options: {
  model: string
  provider?: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  responseModel?: string
  errorType?: string
  stream?: boolean
  timeToFirstChunkMs?: number
}): void {
  if (!finiteNonNegative(options.durationMs)) return
  const attributes = genAiInferenceAttributes(options.model, {
    provider: options.provider,
  })
  if (options.responseModel) {
    attributes['gen_ai.response.model'] = options.responseModel
  }
  if (options.errorType) attributes['error.type'] = options.errorType

  const { operationDuration, timeToFirstChunk, tokenUsage } = getInstruments()
  operationDuration.record(options.durationMs / 1000, attributes)
  if (
    options.stream === true &&
    finitePositive(options.timeToFirstChunkMs)
  ) {
    timeToFirstChunk.record(options.timeToFirstChunkMs / 1000, attributes)
  }
  if (finiteNonNegative(options.inputTokens)) {
    tokenUsage.record(options.inputTokens, {
      ...attributes,
      'gen_ai.token.type': 'input',
    })
  }
  if (finiteNonNegative(options.outputTokens)) {
    tokenUsage.record(options.outputTokens, {
      ...attributes,
      'gen_ai.token.type': 'output',
    })
  }
}

/**
 * Record the interval between consecutive provider output chunks. Callers
 * invoke this only for chunks after the first one in a streaming response.
 */
export function recordGenAiOutputChunkMetric(options: {
  model: string
  provider?: string
  responseModel?: string
  durationMs: number
}): void {
  if (!finiteNonNegative(options.durationMs)) return
  try {
    const attributes = genAiInferenceAttributes(options.model, {
      provider: options.provider,
    })
    if (options.responseModel) {
      attributes['gen_ai.response.model'] = options.responseModel
    }
    getInstruments().timePerOutputChunk.record(
      options.durationMs / 1000,
      attributes,
    )
  } catch {
    // Telemetry must never interrupt a provider stream.
  }
}

export function recordGenAiAgentDuration(
  durationMs: number,
  errorType?: string,
): void {
  if (!finiteNonNegative(durationMs)) return
  const attributes = genAiAgentAttributes()
  if (errorType) attributes['error.type'] = errorType
  getInstruments().agentDuration.record(durationMs / 1000, attributes)
}

export function recordGenAiToolDuration(
  toolName: string,
  durationMs: number,
  errorType?: string,
): void {
  if (!finiteNonNegative(durationMs)) return
  const attributes = genAiToolAttributes(toolName)
  if (errorType) attributes['error.type'] = errorType
  getInstruments().toolDuration.record(durationMs / 1000, attributes)
}

/** Tests reset the lazy API instruments after replacing the global provider. */
export function resetGenAiInstrumentsForTesting(): void {
  instruments = undefined
}

/** Inject test instruments without enabling an exporter or global SDK. */
export function setGenAiInstrumentsForTesting(
  value: GenAiInstruments,
): void {
  instruments = value
}
