/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { writeSync } from 'node:fs'
import {
  applyConfigAssignments,
  getConfigAssignmentValues,
  parseConfigAssignments,
  resolveConfigAssignmentKey,
} from '../../commands/config/configAssignments.js'
import { getActiveProviderSettings } from '../../services/providers/providerRegistry.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import {
  PROVIDER_CONFIG_KEYS,
  providerConfigSetHandler,
  type ProviderConfigKey,
} from './providers.js'

type ConfigValue = boolean | number | string | null

export type CliConfigEntry = {
  key: string
  value: ConfigValue
  category: 'agent' | 'provider'
}

function writeOutput(text: string): void {
  /* eslint-disable-next-line custom-rules/no-sync-fs -- process exits immediately */
  writeSync(1, text.endsWith('\n') ? text : `${text}\n`)
}

function writeError(text: string): void {
  /* eslint-disable-next-line custom-rules/no-sync-fs -- process exits immediately */
  writeSync(2, text.endsWith('\n') ? text : `${text}\n`)
}

function providerConfigEntries(): CliConfigEntry[] {
  const settings = getInitialSettings()
  const active = getActiveProviderSettings(settings)
  const configured = settings.provider ?? {}
  return [
    { key: 'provider', value: active.active ?? 'ollama', category: 'provider' },
    {
      key: 'provider.fallback',
      value: active.fallback ?? null,
      category: 'provider',
    },
    {
      key: 'provider.command_path',
      value: active.commandPath ?? null,
      category: 'provider',
    },
    {
      key: 'openai_transport',
      value: configured.openaiTransport ?? null,
      category: 'provider',
    },
    {
      key: 'responses.store',
      value: configured.responses?.store ?? null,
      category: 'provider',
    },
    {
      key: 'responses.compact_threshold',
      value: configured.responses?.compactThreshold ?? null,
      category: 'provider',
    },
    {
      key: 'responses.tool_search',
      value: configured.responses?.toolSearch ?? null,
      category: 'provider',
    },
    { key: 'model', value: active.model ?? null, category: 'provider' },
    { key: 'base_url', value: active.baseUrl ?? null, category: 'provider' },
  ]
}

export function listCliConfigEntries(): CliConfigEntry[] {
  return [
    ...getConfigAssignmentValues().map(entry => ({
      ...entry,
      category: 'agent' as const,
    })),
    ...providerConfigEntries(),
  ]
}

function textValue(value: ConfigValue): string {
  return value === null ? '(not set)' : String(value)
}

function findEntry(key: string): CliConfigEntry | undefined {
  const assignmentKey = resolveConfigAssignmentKey(key)
  const canonical = assignmentKey ?? key.toLowerCase()
  return listCliConfigEntries().find(entry => entry.key === canonical)
}

export async function configSetHandler(
  key: string,
  values: string | string[],
): Promise<void> {
  const value = Array.isArray(values) ? values.join(' ') : values
  if (resolveConfigAssignmentKey(key)) {
    const parsed = parseConfigAssignments(`${key}=${value}`)
    if (parsed.error) {
      writeError(parsed.error)
      process.exit(1)
    }
    const result = applyConfigAssignments(parsed.assignments)
    if (result.error) {
      writeError(result.error)
      process.exit(1)
    }
    writeOutput(`Updated ${result.applied.join(', ')}.`)
    process.exit(0)
  }

  if (!PROVIDER_CONFIG_KEYS.includes(key as ProviderConfigKey)) {
    writeError(
      `Unsupported config key "${key}". Run "ur config list" to see supported settings.`,
    )
    process.exit(1)
  }
  await providerConfigSetHandler(key, value)
}

export function configGetHandler(
  key: string,
  options: { json?: boolean } = {},
): void {
  const entry = findEntry(key)
  if (!entry) {
    writeError(
      `Unknown config key "${key}". Run "ur config list" to see supported settings.`,
    )
    process.exit(1)
  }
  writeOutput(
    options.json
      ? JSON.stringify(entry, null, 2)
      : `${entry.key}=${textValue(entry.value)}`,
  )
  process.exit(0)
}

export function configListHandler(options: { json?: boolean } = {}): void {
  const entries = listCliConfigEntries()
  writeOutput(
    options.json
      ? JSON.stringify(entries, null, 2)
      : entries
          .map(entry => `${entry.key}=${textValue(entry.value)}`)
          .join('\n'),
  )
  process.exit(0)
}
