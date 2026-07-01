/**
 * Plugin doctor — discovers plugin directories, validates their
 * `.ur-plugin/plugin.json` against the manifest schema, and reports declared
 * components and the capability surface each plugin touches. Pure and testable.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PluginManifestSchema, type PluginManifest } from './schemas.js'

export type PluginDoctorEntry = {
  name: string
  path: string
  ok: boolean
  version?: string
  components: string[]
  capabilities: string[]
  errors: string[]
}

export type PluginDoctorReport = {
  ok: boolean
  scanned: number
  plugins: PluginDoctorEntry[]
}

const COMPONENT_KEYS = [
  'commands',
  'agents',
  'skills',
  'templates',
  'validators',
  'outputStyles',
  'hooks',
] as const

const CAPABILITY_KEYS = [
  'commands',
  'skills',
  'templates',
  'validators',
  'hooks',
  'agents',
  'outputStyles',
  'mcpServers',
  'lspServers',
  'languageAdapters',
] as const

function manifestPathFor(dir: string): string | null {
  const p = join(dir, '.ur-plugin', 'plugin.json')
  return existsSync(p) ? p : null
}

export function discoverPluginDirs(roots: string[]): string[] {
  const dirs: string[] = []
  const seen = new Set<string>()
  const add = (dir: string) => {
    if (!seen.has(dir)) {
      seen.add(dir)
      dirs.push(dir)
    }
  }
  for (const root of roots) {
    if (!root || !existsSync(root)) continue
    if (manifestPathFor(root)) {
      add(root)
      continue
    }
    let entries: string[] = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(root, entry)
      try {
        if (statSync(full).isDirectory() && manifestPathFor(full)) add(full)
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return dirs
}

function keysPresent(value: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter(key => value[key] !== undefined && value[key] !== null)
}

export function doctorPluginDir(dir: string): PluginDoctorEntry {
  const manifestPath = manifestPathFor(dir)
  if (!manifestPath) {
    return {
      name: basename(dir),
      path: dir,
      ok: false,
      components: [],
      capabilities: [],
      errors: ['Missing .ur-plugin/plugin.json'],
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return {
      name: basename(dir),
      path: dir,
      ok: false,
      components: [],
      capabilities: [],
      errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
  const raw = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const result = PluginManifestSchema().safeParse(parsed)
  if (!result.success) {
    return {
      name: typeof raw.name === 'string' ? raw.name : basename(dir),
      path: dir,
      ok: false,
      version: typeof raw.version === 'string' ? raw.version : undefined,
      components: keysPresent(raw, COMPONENT_KEYS),
      capabilities: keysPresent(raw, CAPABILITY_KEYS),
      errors: result.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    }
  }
  const manifest = result.data as PluginManifest & Record<string, unknown>
  return {
    name: manifest.name,
    path: dir,
    ok: true,
    version: manifest.version,
    components: keysPresent(manifest, COMPONENT_KEYS),
    capabilities: keysPresent(manifest, CAPABILITY_KEYS),
    errors: [],
  }
}

export function runPluginDoctor(roots: string[]): PluginDoctorReport {
  const dirs = discoverPluginDirs(roots)
  const plugins = dirs.map(doctorPluginDir).sort((a, b) => a.name.localeCompare(b.name))
  return {
    ok: plugins.every(p => p.ok),
    scanned: plugins.length,
    plugins,
  }
}

export function formatPluginDoctor(report: PluginDoctorReport, json = false): string {
  if (json) return JSON.stringify(report, null, 2)
  if (report.scanned === 0) {
    return 'No plugins found. Add plugins under .ur/plugins or install from a marketplace.'
  }
  const lines = [`Plugin doctor: ${report.ok ? 'all manifests valid' : 'issues found'} (${report.scanned} scanned)`]
  for (const plugin of report.plugins) {
    lines.push(
      `  ${plugin.ok ? 'OK  ' : 'FAIL'} ${plugin.name}${plugin.version ? `@${plugin.version}` : ''}` +
        (plugin.capabilities.length > 0 ? ` [${plugin.capabilities.join(', ')}]` : ''),
    )
    for (const error of plugin.errors) {
      lines.push(`       - ${error}`)
    }
  }
  return lines.join('\n')
}
