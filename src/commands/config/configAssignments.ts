import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

export const CONFIG_ASSIGNMENT_HELP = [
  'Usage: /config <key>=<value> [key=value ...]',
  'CLI:   ur config set <key> <value>',
  '',
  'Supported settings:',
  '  thinking=true|false       Enable or disable model thinking',
  '  screenReader=true|false   Use append-only accessible terminal output',
  '  reducedMotion=true|false  Disable terminal animations',
  '  verbose=true|false        Show or hide detailed tool output',
  '  autoCompact=true|false    Compact long conversations automatically',
  '  editor=normal|vim         Select standard or Vim input editing',
  '  vimEscape=<sequence>      Leave Vim insert mode with a sequence such as jj',
  '',
  'Run /config without arguments to open the interactive settings panel.',
].join('\n')

export type ConfigAssignment = {
  key:
    | 'thinking'
    | 'screenReader'
    | 'reducedMotion'
    | 'verbose'
    | 'autoCompact'
    | 'editor'
    | 'vimEscape'
  value: boolean | 'normal' | 'vim' | string
}

const KEY_ALIASES: Record<string, ConfigAssignment['key']> = {
  thinking: 'thinking',
  screenreader: 'screenReader',
  reducedmotion: 'reducedMotion',
  verbose: 'verbose',
  autocompact: 'autoCompact',
  editor: 'editor',
  vimescape: 'vimEscape',
}

export function resolveConfigAssignmentKey(
  rawKey: string,
): ConfigAssignment['key'] | undefined {
  return KEY_ALIASES[rawKey.replaceAll('-', '').toLowerCase()]
}

function booleanValue(value: string): boolean | undefined {
  if (value === 'true' || value === 'on' || value === 'enabled') return true
  if (value === 'false' || value === 'off' || value === 'disabled') return false
  return undefined
}

export function parseConfigAssignments(input: string):
  | { assignments: ConfigAssignment[]; error?: never }
  | { assignments?: never; error: string } {
  const tokens = input.trim().split(/\s+/u).filter(Boolean)
  const assignments: ConfigAssignment[] = []
  for (const token of tokens) {
    const separator = token.indexOf('=')
    if (separator <= 0 || separator === token.length - 1) {
      return { error: `Invalid assignment '${token}'. Expected key=value.` }
    }
    const rawKey = token.slice(0, separator)
    const rawValue = token.slice(separator + 1).toLowerCase()
    const key = resolveConfigAssignmentKey(rawKey)
    if (!key) return { error: `Unknown setting '${token.slice(0, separator)}'.` }
    if (key === 'editor') {
      if (rawValue !== 'normal' && rawValue !== 'vim') {
        return { error: "editor must be 'normal' or 'vim'." }
      }
      assignments.push({ key, value: rawValue })
      continue
    }
    if (key === 'vimEscape') {
      if (rawValue === 'off' || rawValue === 'disabled' || rawValue === 'none') {
        assignments.push({ key, value: '' })
        continue
      }
      if (rawValue.length < 2 || rawValue.length > 8 || /[\s\p{C}]/u.test(rawValue)) {
        return { error: 'vimEscape must be 2-8 printable non-whitespace characters, or off.' }
      }
      assignments.push({ key, value: token.slice(separator + 1) })
      continue
    }
    const value = booleanValue(rawValue)
    if (value === undefined) return { error: `${key} must be true or false.` }
    assignments.push({ key, value })
  }
  return { assignments }
}

export type ConfigAssignmentEffects = {
  thinking?(value: boolean): void
  screenReader?(value: boolean): void
  reducedMotion?(value: boolean): void
  verbose?(value: boolean): void
}

export type AppliedConfigAssignments =
  | { applied: string[]; error?: never }
  | { applied?: never; error: string }

/** Persist prompt and CLI assignments through one validation/write path. */
export function applyConfigAssignments(
  assignments: ConfigAssignment[],
  effects: ConfigAssignmentEffects = {},
): AppliedConfigAssignments {
  const applied: string[] = []
  for (const assignment of assignments) {
    switch (assignment.key) {
      case 'thinking': {
        const value = assignment.value as boolean
        const result = updateSettingsForSource('userSettings', {
          alwaysThinkingEnabled: value ? undefined : false,
        })
        if (result.error) {
          return { error: `Could not update thinking: ${result.error.message}` }
        }
        effects.thinking?.(value)
        applied.push(`thinking=${value}`)
        break
      }
      case 'screenReader': {
        const value = assignment.value as boolean
        const result = updateSettingsForSource('localSettings', {
          screenReaderMode: value,
        })
        if (result.error) {
          return {
            error: `Could not update screen reader mode: ${result.error.message}`,
          }
        }
        effects.screenReader?.(value)
        applied.push(`screenReader=${value}`)
        break
      }
      case 'reducedMotion': {
        const value = assignment.value as boolean
        const result = updateSettingsForSource('localSettings', {
          prefersReducedMotion: value,
        })
        if (result.error) {
          return {
            error: `Could not update reduced motion: ${result.error.message}`,
          }
        }
        effects.reducedMotion?.(value)
        applied.push(`reducedMotion=${value}`)
        break
      }
      case 'verbose': {
        const value = assignment.value as boolean
        const result = updateSettingsForSource('userSettings', {
          verbose: value,
        })
        if (result.error) {
          return {
            error: `Could not update verbose output: ${result.error.message}`,
          }
        }
        effects.verbose?.(value)
        applied.push(`verbose=${value}`)
        break
      }
      case 'autoCompact': {
        const value = assignment.value as boolean
        saveGlobalConfig(previous => ({
          ...previous,
          autoCompactEnabled: value,
        }))
        applied.push(`autoCompact=${value}`)
        break
      }
      case 'editor': {
        const value = assignment.value as 'normal' | 'vim'
        saveGlobalConfig(previous => ({ ...previous, editorMode: value }))
        applied.push(`editor=${value}`)
        break
      }
      case 'vimEscape': {
        const value = assignment.value as string
        saveGlobalConfig(previous => ({
          ...previous,
          vimInsertModeEscapeSequence: value || undefined,
        }))
        applied.push(`vimEscape=${value || 'off'}`)
        break
      }
    }
  }
  return { applied }
}

export type ConfigAssignmentValue = {
  key: ConfigAssignment['key']
  value: boolean | 'normal' | 'vim' | string
}

/** Read the effective values exposed by both `/config` and `ur config`. */
export function getConfigAssignmentValues(): ConfigAssignmentValue[] {
  const settings = getInitialSettings()
  const global = getGlobalConfig()
  return [
    { key: 'thinking', value: settings.alwaysThinkingEnabled !== false },
    { key: 'screenReader', value: settings.screenReaderMode === true },
    { key: 'reducedMotion', value: settings.prefersReducedMotion === true },
    { key: 'verbose', value: settings.verbose === true },
    { key: 'autoCompact', value: global.autoCompactEnabled },
    { key: 'editor', value: global.editorMode ?? 'normal' },
    {
      key: 'vimEscape',
      value: global.vimInsertModeEscapeSequence || 'off',
    },
  ]
}
