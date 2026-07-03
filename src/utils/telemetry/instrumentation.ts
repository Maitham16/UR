/**
 * Telemetry / OpenTelemetry instrumentation.
 *
 * OpenTelemetry and all exporters have been removed from external builds.
 * This module exposes the same API surface so callers compile, but every
 * entry point is a no-op and never performs network I/O.
 */

export function bootstrapTelemetry() {
  // No-op: telemetry is disabled in external builds.
}

export function parseExporterTypes(value: string | undefined): string[] {
  return (value || '')
    .trim()
    .split(',')
    .filter(Boolean)
    .map(t => t.trim())
    .filter(t => t !== 'none')
}

export function isTelemetryEnabled() {
  return false
}

export async function initializeTelemetry(): Promise<null> {
  // Telemetry is disabled in external builds.
  return null
}

export async function flushTelemetry(): Promise<void> {
  // No-op: telemetry is disabled in external builds.
}
