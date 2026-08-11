export const CONFIG_ASSIGNMENT_HELP = [
  'Usage: /config <key>=<value> [key=value ...]',
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
    const rawKey = token.slice(0, separator).replaceAll('-', '').toLowerCase()
    const rawValue = token.slice(separator + 1).toLowerCase()
    const key = KEY_ALIASES[rawKey]
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
