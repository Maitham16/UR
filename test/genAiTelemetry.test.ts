import { afterEach, describe, expect, test } from 'bun:test'
import {
  classifyGenAiError,
  endGenAiMemorySpan,
  endGenAiWorkflowSpan,
  genAiAgentAttributes,
  genAiInferenceAttributes,
  genAiToolAttributes,
  genAiWorkflowAttributes,
  recordGenAiClientMetrics,
  recordGenAiOutputChunkMetric,
  resetGenAiInstrumentsForTesting,
  resolveGenAiProvider,
  setGenAiInstrumentsForTesting,
  shouldCaptureGenAiContent,
  truncateGenAiContent,
} from '../src/utils/telemetry/genAiSemantics.js'
import {
  isTelemetryEnabled,
  parseExporterTypes,
} from '../src/utils/telemetry/instrumentation.js'

const envKeys = [
  'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT',
  'OTEL_LOGS_EXPORTER',
  'OTEL_METRICS_EXPORTER',
  'OTEL_SDK_DISABLED',
  'OTEL_TRACES_EXPORTER',
  'UR_OTEL_GENAI_PROVIDER',
] as const
const initialEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))

afterEach(() => {
  resetGenAiInstrumentsForTesting()
  for (const key of envKeys) {
    const value = initialEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('OpenTelemetry GenAI semantic conventions', () => {
  test('emits required inference, agent, and tool attributes', () => {
    expect(genAiInferenceAttributes('gpt-5.4', { stream: true })).toEqual({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-5.4',
      'gen_ai.request.stream': true,
    })
    expect(genAiAgentAttributes()).toMatchObject({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': 'ur',
      'gen_ai.agent.name': 'UR-Nexus',
      'gen_ai.agent.version': MACRO.VERSION,
    })
    expect(genAiToolAttributes('Read', { callId: 'call_1' })).toEqual({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'Read',
      'gen_ai.tool.call.id': 'call_1',
    })
    expect(genAiWorkflowAttributes('release-validation')).toEqual({
      'gen_ai.operation.name': 'invoke_workflow',
      'gen_ai.workflow.name': 'release-validation',
    })
  })

  test('uses known provider names and supports a bounded gateway override', () => {
    expect(resolveGenAiProvider('claude-sonnet-4-6')).toBe('anthropic')
    expect(resolveGenAiProvider('gemini-3-pro')).toBe('gcp.gemini')
    expect(resolveGenAiProvider('deepseek-v3')).toBe('deepseek')
    expect(resolveGenAiProvider('local-model')).toBe('ur')

    process.env.UR_OTEL_GENAI_PROVIDER = 'azure.ai.openai'
    expect(resolveGenAiProvider('gateway-model')).toBe('azure.ai.openai')
    process.env.UR_OTEL_GENAI_PROVIDER = 'invalid provider with spaces'
    expect(resolveGenAiProvider('gateway-model')).toBe('ur')
  })

  test('classifies errors without exporting raw error messages', () => {
    expect(classifyGenAiError({ statusCode: 429, error: 'secret' })).toBe('429')
    expect(classifyGenAiError({ error: 'request timed out with token abc' })).toBe(
      'timeout',
    )
    expect(classifyGenAiError({ error: 'very specific private failure' })).toBe(
      '_OTHER',
    )
    expect(classifyGenAiError({})).toBeUndefined()
  })

  test('keeps content capture off by default and applies a hard size bound', () => {
    delete process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT
    expect(shouldCaptureGenAiContent()).toBe(false)
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = 'true'
    expect(shouldCaptureGenAiContent()).toBe(true)

    const truncated = truncateGenAiContent('x'.repeat(70 * 1024))
    expect(truncated.endsWith('\n[TRUNCATED]')).toBe(true)
    expect(truncated.length).toBeLessThan(61 * 1024)
  })

  test('never lets a faulty telemetry span break memory operations', () => {
    const faultySpan = {
      setAttribute: () => {
        throw new Error('exporter failed')
      },
      setStatus: () => {
        throw new Error('exporter failed')
      },
      end: () => {
        throw new Error('exporter failed')
      },
    }

    expect(() =>
      endGenAiMemorySpan(faultySpan as never, {
        recordId: 'memory-1',
        recordCount: 1,
      }),
    ).not.toThrow()
    expect(() =>
      endGenAiWorkflowSpan(faultySpan as never, {
        errorType: 'workflow_failed',
      }),
    ).not.toThrow()
  })

  test('records first-chunk timing only through the streaming metric path', () => {
    const firstChunkValues: number[] = []
    const histogram = { record: () => undefined }
    setGenAiInstrumentsForTesting({
      operationDuration: histogram,
      timeToFirstChunk: {
        record: value => firstChunkValues.push(value),
      },
      timePerOutputChunk: histogram,
      tokenUsage: histogram,
      agentDuration: histogram,
      toolDuration: histogram,
    } as never)

    recordGenAiClientMetrics({
      model: 'local-model',
      durationMs: 50,
      stream: true,
      timeToFirstChunkMs: 10,
    })
    recordGenAiClientMetrics({
      model: 'local-model',
      durationMs: 50,
      stream: false,
      timeToFirstChunkMs: 20,
    })
    recordGenAiClientMetrics({
      model: 'local-model',
      durationMs: 50,
      stream: true,
      timeToFirstChunkMs: 0,
    })

    expect(firstChunkValues).toEqual([0.01])
  })

  test('records each valid streaming output-chunk interval in seconds', () => {
    const outputChunkValues: number[] = []
    const histogram = { record: () => undefined }
    setGenAiInstrumentsForTesting({
      operationDuration: histogram,
      timeToFirstChunk: histogram,
      timePerOutputChunk: {
        record: value => outputChunkValues.push(value),
      },
      tokenUsage: histogram,
      agentDuration: histogram,
      toolDuration: histogram,
    } as never)

    recordGenAiOutputChunkMetric({
      model: 'local-model',
      durationMs: 12.5,
    })
    recordGenAiOutputChunkMetric({
      model: 'local-model',
      durationMs: Number.NaN,
    })
    recordGenAiOutputChunkMetric({
      model: 'local-model',
      durationMs: -1,
    })

    expect(outputChunkValues).toEqual([0.0125])

    setGenAiInstrumentsForTesting({
      operationDuration: histogram,
      timeToFirstChunk: histogram,
      timePerOutputChunk: {
        record: () => {
          throw new Error('faulty exporter')
        },
      },
      tokenUsage: histogram,
      agentDuration: histogram,
      toolDuration: histogram,
    } as never)
    expect(() =>
      recordGenAiOutputChunkMetric({
        model: 'local-model',
        durationMs: 4,
      }),
    ).not.toThrow()
  })
})

describe('OpenTelemetry exporter configuration', () => {
  test('parses, normalizes, and de-duplicates supported exporters', () => {
    expect(parseExporterTypes(undefined)).toEqual([])
    expect(parseExporterTypes(' none ')).toEqual([])
    expect(parseExporterTypes(' OTLP,console,otlp ')).toEqual([
      'otlp',
      'console',
    ])
    expect(() => parseExporterTypes('none,otlp')).toThrow('cannot be combined')
    expect(() => parseExporterTypes('zipkin')).toThrow('Unsupported')
  })

  test('requires explicit signal exporters and honors the SDK kill switch', () => {
    delete process.env.OTEL_TRACES_EXPORTER
    delete process.env.OTEL_METRICS_EXPORTER
    delete process.env.OTEL_LOGS_EXPORTER
    delete process.env.OTEL_SDK_DISABLED
    expect(isTelemetryEnabled()).toBe(false)

    process.env.OTEL_TRACES_EXPORTER = 'otlp'
    expect(isTelemetryEnabled()).toBe(true)
    process.env.OTEL_SDK_DISABLED = 'true'
    expect(isTelemetryEnabled()).toBe(false)
  })
})
