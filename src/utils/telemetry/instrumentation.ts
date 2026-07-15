/**
 * Explicitly configured OpenTelemetry SDK bootstrap.
 *
 * No exporter is enabled by default. Operators opt in per signal with the
 * standard OTEL_{TRACES,METRICS,LOGS}_EXPORTER variables. Only the official
 * `otlp` (HTTP/protobuf) and `console` exporters are supported.
 */

import { diag, DiagLogLevel, metrics, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import {
  defaultResource,
  detectResources,
  envDetector,
  resourceFromAttributes,
} from '@opentelemetry/resources'
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
  type LogRecordProcessor,
} from '@opentelemetry/sdk-logs'
import {
  AggregationType,
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type IMetricReader,
  type ViewOptions,
} from '@opentelemetry/sdk-metrics'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import {
  setEventLogger,
  setLoggerProvider,
  setMeter,
  setMeterProvider,
  setTracerProvider,
} from '../../bootstrap/state.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { URCodeDiagLogger } from './logger.js'

export type TelemetryExporterType = 'console' | 'otlp'

export type TelemetryRuntime = {
  tracerProvider: BasicTracerProvider | null
  meterProvider: MeterProvider | null
  loggerProvider: LoggerProvider | null
}

const SUPPORTED_EXPORTERS = new Set<TelemetryExporterType>(['console', 'otlp'])
const DEFAULT_METRIC_INTERVAL_MS = 60_000
const DEFAULT_LOG_INTERVAL_MS = 5_000
const MIN_EXPORT_INTERVAL_MS = 1_000
const MAX_EXPORT_INTERVAL_MS = 24 * 60 * 60 * 1_000

let runtime: TelemetryRuntime | null = null
let initialization: Promise<TelemetryRuntime | null> | null = null
let cleanupRegistered = false

export function bootstrapTelemetry(): void {
  diag.setLogger(new URCodeDiagLogger(), DiagLogLevel.WARN)
}

export function parseExporterTypes(
  value: string | undefined,
): TelemetryExporterType[] {
  const raw = (value ?? '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
  if (raw.length === 0 || (raw.length === 1 && raw[0] === 'none')) return []
  if (raw.includes('none')) {
    throw new Error('OpenTelemetry exporter "none" cannot be combined with another exporter')
  }

  const unique: TelemetryExporterType[] = []
  for (const exporter of raw) {
    if (!SUPPORTED_EXPORTERS.has(exporter as TelemetryExporterType)) {
      throw new Error(
        `Unsupported OpenTelemetry exporter "${exporter}". Supported: otlp, console, none`,
      )
    }
    if (!unique.includes(exporter as TelemetryExporterType)) {
      unique.push(exporter as TelemetryExporterType)
    }
  }
  return unique
}

function configuredExporters(): {
  traces: TelemetryExporterType[]
  metrics: TelemetryExporterType[]
  logs: TelemetryExporterType[]
} {
  return {
    traces: parseExporterTypes(process.env.OTEL_TRACES_EXPORTER),
    metrics: parseExporterTypes(process.env.OTEL_METRICS_EXPORTER),
    logs: parseExporterTypes(process.env.OTEL_LOGS_EXPORTER),
  }
}

export function isTelemetryEnabled(): boolean {
  if (isEnvTruthy(process.env.OTEL_SDK_DISABLED)) return false
  try {
    const exporters = configuredExporters()
    return Object.values(exporters).some(signal => signal.length > 0)
  } catch {
    // Initialization reports the actionable configuration error. Hot paths
    // should simply use the no-op global providers until then.
    return false
  }
}

function validateOtlpProtocol(signal: 'TRACES' | 'METRICS' | 'LOGS'): void {
  const protocol =
    process.env[`OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`] ??
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL ??
    'http/protobuf'
  if (protocol.trim().toLowerCase() !== 'http/protobuf') {
    throw new Error(
      `OTLP ${signal.toLowerCase()} protocol must be "http/protobuf"; received "${protocol}"`,
    )
  }
}

function validateOtlpEndpoint(signal: 'TRACES' | 'METRICS' | 'LOGS'): void {
  const endpoint =
    process.env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`] ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error(`Invalid OTLP ${signal.toLowerCase()} endpoint URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `OTLP ${signal.toLowerCase()} endpoint must use http or https`,
    )
  }
}

function parseInterval(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_EXPORT_INTERVAL_MS ||
    parsed > MAX_EXPORT_INTERVAL_MS
  ) {
    throw new Error(
      `OpenTelemetry export interval must be an integer from ${MIN_EXPORT_INTERVAL_MS} to ${MAX_EXPORT_INTERVAL_MS} milliseconds`,
    )
  }
  return parsed
}

function genAiMetricViews(): ViewOptions[] {
  const operationBoundaries = [
    0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24,
    20.48, 40.96, 81.92,
  ]
  const tokenBoundaries = [
    1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576,
    4194304, 16777216, 67108864,
  ]
  return [
    {
      instrumentName: 'gen_ai.client.operation.duration',
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        options: { boundaries: operationBoundaries },
      },
      aggregationCardinalityLimit: 2_000,
    },
    {
      instrumentName: 'gen_ai.client.operation.time_to_first_chunk',
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        options: { boundaries: operationBoundaries },
      },
      aggregationCardinalityLimit: 2_000,
    },
    {
      instrumentName: 'gen_ai.client.operation.time_per_output_chunk',
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        options: { boundaries: operationBoundaries },
      },
      aggregationCardinalityLimit: 2_000,
    },
    {
      instrumentName: 'gen_ai.execute_tool.duration',
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        options: { boundaries: operationBoundaries },
      },
      aggregationCardinalityLimit: 2_000,
    },
    {
      instrumentName: 'gen_ai.invoke_agent.duration',
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        options: {
          boundaries: [
            0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8, 25.6, 51.2,
            102.4, 204.8, 409.6,
          ],
        },
      },
      aggregationCardinalityLimit: 2_000,
    },
    {
      instrumentName: 'gen_ai.client.token.usage',
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        options: { boundaries: tokenBoundaries },
      },
      aggregationCardinalityLimit: 2_000,
    },
  ]
}

function buildTraceProcessors(
  exporters: TelemetryExporterType[],
): SpanProcessor[] {
  return exporters.map(exporter => {
    if (exporter === 'console') {
      return new SimpleSpanProcessor(new ConsoleSpanExporter())
    }
    validateOtlpProtocol('TRACES')
    validateOtlpEndpoint('TRACES')
    return new BatchSpanProcessor(new OTLPTraceExporter())
  })
}

function buildMetricReaders(
  exporters: TelemetryExporterType[],
): IMetricReader[] {
  const interval = parseInterval(
    process.env.OTEL_METRIC_EXPORT_INTERVAL,
    DEFAULT_METRIC_INTERVAL_MS,
  )
  return exporters.map(exporter => {
    if (exporter === 'console') {
      return new PeriodicExportingMetricReader({
        exporter: new ConsoleMetricExporter(),
        exportIntervalMillis: interval,
      })
    }
    validateOtlpProtocol('METRICS')
    validateOtlpEndpoint('METRICS')
    return new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: interval,
    })
  })
}

function buildLogProcessors(
  exporters: TelemetryExporterType[],
): LogRecordProcessor[] {
  const interval = parseInterval(
    process.env.OTEL_LOGS_EXPORT_INTERVAL,
    DEFAULT_LOG_INTERVAL_MS,
  )
  return exporters.map(exporter => {
    if (exporter === 'console') {
      return new SimpleLogRecordProcessor({
        exporter: new ConsoleLogRecordExporter(),
      })
    }
    validateOtlpProtocol('LOGS')
    validateOtlpEndpoint('LOGS')
    return new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter(),
      scheduledDelayMillis: interval,
    })
  })
}

async function createRuntime(): Promise<TelemetryRuntime | null> {
  if (isEnvTruthy(process.env.OTEL_SDK_DISABLED)) return null
  const exporters = configuredExporters()
  if (!Object.values(exporters).some(signal => signal.length > 0)) return null

  bootstrapTelemetry()
  const resource = defaultResource()
    .merge(detectResources({ detectors: [envDetector] }))
    .merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'ur-agent',
        [ATTR_SERVICE_VERSION]: MACRO.VERSION,
      }),
    )

  const tracerProvider =
    exporters.traces.length > 0
      ? new BasicTracerProvider({
          resource,
          spanProcessors: buildTraceProcessors(exporters.traces),
        })
      : null
  const meterProvider =
    exporters.metrics.length > 0
      ? new MeterProvider({
          resource,
          readers: buildMetricReaders(exporters.metrics),
          views: genAiMetricViews(),
        })
      : null
  const loggerProvider =
    exporters.logs.length > 0
      ? new LoggerProvider({
          resource,
          processors: buildLogProcessors(exporters.logs),
        })
      : null

  if (tracerProvider && !trace.setGlobalTracerProvider(tracerProvider)) {
    await tracerProvider.shutdown()
    await meterProvider?.shutdown()
    await loggerProvider?.shutdown()
    throw new Error('An OpenTelemetry tracer provider is already registered')
  }
  if (meterProvider && !metrics.setGlobalMeterProvider(meterProvider)) {
    await tracerProvider?.shutdown()
    await meterProvider.shutdown()
    await loggerProvider?.shutdown()
    throw new Error('An OpenTelemetry meter provider is already registered')
  }
  if (loggerProvider) logs.setGlobalLoggerProvider(loggerProvider)

  setTracerProvider(tracerProvider)
  setMeterProvider(meterProvider)
  setLoggerProvider(loggerProvider)

  if (meterProvider) {
    const meter = meterProvider.getMeter('ur-agent', MACRO.VERSION)
    setMeter(meter, (name, options) => meter.createCounter(name, options))
  }
  if (loggerProvider) {
    setEventLogger(loggerProvider.getLogger('ur-agent.events', MACRO.VERSION))
  }

  if (!cleanupRegistered) {
    cleanupRegistered = true
    registerCleanup(shutdownTelemetry)
  }

  logForDebugging(
    `[3P telemetry] initialized traces=${exporters.traces.join('|') || 'none'} metrics=${exporters.metrics.join('|') || 'none'} logs=${exporters.logs.join('|') || 'none'}`,
  )
  return { tracerProvider, meterProvider, loggerProvider }
}

export async function initializeTelemetry(): Promise<TelemetryRuntime | null> {
  if (runtime) return runtime
  if (!initialization) {
    initialization = createRuntime()
      .then(value => {
        runtime = value
        return value
      })
      .finally(() => {
        initialization = null
      })
  }
  return initialization
}

export async function flushTelemetry(): Promise<void> {
  if (!runtime) return
  const results = await Promise.allSettled([
    runtime.tracerProvider?.forceFlush(),
    runtime.meterProvider?.forceFlush(),
    runtime.loggerProvider?.forceFlush(),
  ])
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failure) throw failure.reason
}

export async function shutdownTelemetry(): Promise<void> {
  const current = runtime
  if (!current) return
  runtime = null
  setEventLogger(null)
  setLoggerProvider(null)
  setMeterProvider(null)
  setTracerProvider(null)
  await Promise.allSettled([
    current.tracerProvider?.shutdown(),
    current.meterProvider?.shutdown(),
    current.loggerProvider?.shutdown(),
  ])
}
