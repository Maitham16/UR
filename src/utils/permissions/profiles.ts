import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import type { EditableSettingSource } from '../settings/constants.js'
import type { SettingsJson } from '../settings/types.js'

export type ProfileSummary = {
  name: string
  description?: string
  allow: number
  deny: number
  ask: number
  active: boolean
}

/** Sources a user can actually edit, in the order profiles are looked up. */
const LOOKUP_ORDER: EditableSettingSource[] = [
  'localSettings',
  'projectSettings',
  'userSettings',
]

export function listProfiles(
  read: (source: EditableSettingSource) => SettingsJson | null = source =>
    getSettingsForSource(source),
): ProfileSummary[] {
  const summaries: ProfileSummary[] = []
  const seen = new Set<string>()
  for (const source of LOOKUP_ORDER) {
    const permissions = read(source)?.permissions
    const active = permissions?.activeProfile
    for (const [name, profile] of Object.entries(permissions?.profiles ?? {})) {
      // A nearer source shadows a farther one, matching settings precedence.
      if (seen.has(name)) continue
      seen.add(name)
      summaries.push({
        name,
        description: profile.description,
        allow: profile.allow?.length ?? 0,
        deny: profile.deny?.length ?? 0,
        ask: profile.ask?.length ?? 0,
        active: active === name,
      })
    }
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name))
}

export function findProfileSource(
  name: string,
  read: (source: EditableSettingSource) => SettingsJson | null = source =>
    getSettingsForSource(source),
): EditableSettingSource | null {
  for (const source of LOOKUP_ORDER) {
    if (read(source)?.permissions?.profiles?.[name]) return source
  }
  return null
}

export type ProfileSwitchResult = {
  ok: boolean
  /** Present when ok; where the change was written. */
  source?: EditableSettingSource
  /** The profile now active, or null when cleared. */
  profile?: string | null
  /** Present when !ok. */
  error?: string
}

/**
 * Set or clear the active profile, writing to whichever source defines it so
 * the switch lands next to its definition rather than creating a shadowing
 * entry in a different file.
 */
export function setActiveProfile(
  name: string | null,
  deps: {
    read?: (source: EditableSettingSource) => SettingsJson | null
    write?: (
      source: EditableSettingSource,
      settings: SettingsJson,
    ) => { error: Error | null }
  } = {},
): ProfileSwitchResult {
  const read = deps.read ?? (source => getSettingsForSource(source))
  const write = deps.write ?? updateSettingsForSource

  let target: EditableSettingSource | null = null
  if (name === null) {
    // Clearing: act on whichever source currently declares an active profile.
    target =
      LOOKUP_ORDER.find(source => read(source)?.permissions?.activeProfile) ??
      null
    if (!target) return { ok: true, source: 'userSettings', profile: null }
  } else {
    target = findProfileSource(name, read)
    if (!target) {
      const known = listProfiles(read).map(profile => profile.name)
      return {
        ok: false,
        error: known.length
          ? `No profile "${name}". Defined profiles: ${known.join(', ')}`
          : `No profile "${name}". Define one under permissions.profiles first.`,
      }
    }
  }

  const current = read(target) ?? {}
  const permissions = { ...(current.permissions ?? {}) }
  if (name === null) {
    delete permissions.activeProfile
  } else {
    permissions.activeProfile = name
  }
  const { error } = write(target, { ...current, permissions })
  if (error) return { ok: false, error: error.message }
  return { ok: true, source: target, profile: name }
}
