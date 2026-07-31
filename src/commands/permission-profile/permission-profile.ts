import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import {
  listProfiles,
  setActiveProfile,
} from '../../utils/permissions/profiles.js'

function renderList(): string {
  const profiles = listProfiles()
  if (profiles.length === 0) {
    return [
      'No permission profiles defined.',
      '',
      'Add them under permissions.profiles in settings, for example:',
      '  "permissions": {',
      '    "profiles": {',
      '      "reviewing": { "deny": ["Edit", "Write", "Bash"] }',
      '    }',
      '  }',
      'Then: /permission-profile use reviewing',
    ].join('\n')
  }
  const rows = profiles.map(profile => {
    const marker = profile.active ? '*' : ' '
    const counts = `allow ${profile.allow}, deny ${profile.deny}, ask ${profile.ask}`
    const description = profile.description ? ` — ${profile.description}` : ''
    return `${marker} ${profile.name} (${counts})${description}`
  })
  return ['Permission profiles (* = active):', ...rows].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args).filter(token => !token.startsWith('--'))
  const action = (tokens[0] ?? 'list').toLowerCase()

  if (action === 'list' || action === 'show') {
    return { type: 'text', value: renderList() }
  }

  if (action === 'clear' || action === 'none') {
    const result = setActiveProfile(null)
    if (!result.ok) {
      return {
        type: 'text',
        value: `Could not clear the profile: ${result.error}`,
      }
    }
    return {
      type: 'text',
      value: 'Cleared the active permission profile; base rules apply.',
    }
  }

  if (action === 'use' || action === 'set') {
    const name = tokens[1]
    if (!name) {
      return {
        type: 'text',
        value: 'Usage: /permission-profile use <name>\n\n' + renderList(),
      }
    }
    const result = setActiveProfile(name)
    if (!result.ok) {
      return { type: 'text', value: result.error }
    }
    return {
      type: 'text',
      value:
        `Active permission profile is now "${name}" (${result.source}).\n` +
        'Its rules are appended to the base allow/deny/ask lists.',
    }
  }

  return {
    type: 'text',
    value: 'Usage: /permission-profile [list | use <name> | clear]',
  }
}
