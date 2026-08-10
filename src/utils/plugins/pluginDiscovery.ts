/**
 * Deterministic plugin discovery across marketplace, installed, built-in, and
 * session-only catalogs. This module is intentionally pure: the CLI handler
 * owns disk/network access and passes validated catalog data in.
 */

import type { LoadedPlugin } from '../../types/plugin.js'
import type {
  PluginInstallationEntry,
  PluginMarketplaceEntry,
  PluginSource,
} from './schemas.js'

export const PLUGIN_DISCOVERY_CAPABILITIES = [
  'commands',
  'agents',
  'mcp-tools',
  'skills',
  'templates',
  'validators',
  'language-adapters',
  'lsp-servers',
  'hooks',
] as const

export type PluginDiscoveryCapability =
  (typeof PLUGIN_DISCOVERY_CAPABILITIES)[number]

export type PluginCatalogScope =
  | 'builtin'
  | 'session'
  | 'personal'
  | 'workspace'
  | 'managed'
  | 'implicit'
  | 'installed'

export type PluginDiscoveryCatalog = {
  name: string
  scope: PluginCatalogScope
  sourceKind: string
  owner?: string
  entries: PluginMarketplaceEntry[]
}

export type PluginDiscoveryFailure = {
  catalog: string
  error: string
}

export type PluginDiscoveryInput = {
  catalogs: PluginDiscoveryCatalog[]
  installed?: Record<string, PluginInstallationEntry[]>
  enabledPluginIds?: Iterable<string>
  loadedPlugins?: LoadedPlugin[]
  failures?: PluginDiscoveryFailure[]
}

export type PluginDiscoveryResult = {
  pluginId: string
  name: string
  marketplace: string
  catalogScope: PluginCatalogScope
  sourceKind: string
  source: string
  description?: string
  version?: string
  author?: string
  homepage?: string
  repository?: string
  category?: string
  tags: string[]
  capabilities: PluginDiscoveryCapability[]
  installed: boolean
  installedScopes: string[]
  enabled: boolean
  score: number
}

export type PluginSearchOptions = {
  query?: string
  capability?: PluginDiscoveryCapability
  marketplace?: string
  installedOnly?: boolean
  limit?: number
}

export type PluginDiscoveryReport = {
  query: string
  filters: {
    capability?: PluginDiscoveryCapability
    marketplace?: string
    installedOnly: boolean
  }
  catalogsSearched: number
  total: number
  returned: number
  truncated: boolean
  results: PluginDiscoveryResult[]
  failures: PluginDiscoveryFailure[]
}

type MutablePlugin = Omit<PluginDiscoveryResult, 'score'>

const DEFAULT_LIMIT = 20
export const MAX_PLUGIN_SEARCH_LIMIT = 100
export const MAX_PLUGIN_SEARCH_QUERY_LENGTH = 200
const SECRET_QUERY_KEY = /^(?:access_?token|api_?key|auth|authorization|key|password|secret|signature|sig|token)$/i

function redactUrlCredentials(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return value
    parsed.username = ''
    parsed.password = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_KEY.test(key)) parsed.searchParams.set(key, '[redacted]')
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    // Git SSH URLs and owner/repo shorthands have no URL userinfo to redact.
  }
  return value
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

function capabilitiesFromManifest(
  manifest: LoadedPlugin['manifest'],
): PluginDiscoveryCapability[] {
  const capabilities: PluginDiscoveryCapability[] = []
  if (manifest.commands !== undefined) capabilities.push('commands')
  if (manifest.agents !== undefined) capabilities.push('agents')
  if (manifest.mcpServers !== undefined) capabilities.push('mcp-tools')
  if (manifest.skills !== undefined) capabilities.push('skills')
  if (manifest.templates !== undefined) capabilities.push('templates')
  if (manifest.validators !== undefined) capabilities.push('validators')
  if (manifest.languageAdapters !== undefined)
    capabilities.push('language-adapters')
  if (manifest.lspServers !== undefined) capabilities.push('lsp-servers')
  if (manifest.hooks !== undefined) capabilities.push('hooks')
  return capabilities
}

function sourceDisplay(source: PluginSource): string {
  if (typeof source === 'string') return source
  switch (source.source) {
    case 'npm':
      return `npm:${source.package}${source.version ? `@${source.version}` : ''}`
    case 'pip':
      return `pip:${source.package}${source.version ?? ''}`
    case 'github':
      return `github:${source.repo}${source.ref ? `#${source.ref}` : ''}`
    case 'url':
      return `url:${redactUrlCredentials(source.url)}${source.ref ? `#${source.ref}` : ''}`
    case 'git-subdir':
      return `git:${redactUrlCredentials(source.url)}#${source.path}${source.ref ? `@${source.ref}` : ''}`
  }
}

function loadedPluginScope(plugin: LoadedPlugin): PluginCatalogScope {
  if (plugin.isBuiltin || plugin.source.endsWith('@builtin')) return 'builtin'
  if (plugin.source.endsWith('@inline')) return 'session'
  return 'installed'
}

function splitPluginId(pluginId: string): { name: string; marketplace: string } {
  const separator = pluginId.lastIndexOf('@')
  if (separator <= 0 || separator === pluginId.length - 1) {
    return { name: pluginId, marketplace: 'installed' }
  }
  return {
    name: pluginId.slice(0, separator),
    marketplace: pluginId.slice(separator + 1),
  }
}

function mergeLoadedPlugin(target: MutablePlugin, plugin: LoadedPlugin): void {
  const manifest = plugin.manifest
  target.description = manifest.description ?? target.description
  target.version = manifest.version ?? target.version
  target.author = manifest.author?.name ?? target.author
  target.homepage = manifest.homepage ?? target.homepage
  target.repository = manifest.repository ?? target.repository
  target.tags = uniqueSorted([
    ...target.tags,
    ...(manifest.keywords ?? []),
  ])
  target.capabilities = uniqueSorted([
    ...target.capabilities,
    ...capabilitiesFromManifest(manifest),
  ]) as PluginDiscoveryCapability[]
  target.enabled = plugin.enabled ?? target.enabled
}

/** Build a deduplicated inventory before applying a user query. */
export function buildPluginDiscoveryInventory(
  input: PluginDiscoveryInput,
): MutablePlugin[] {
  const installed = input.installed ?? {}
  const enabled = new Set(input.enabledPluginIds ?? [])
  const inventory = new Map<string, MutablePlugin>()

  for (const catalog of input.catalogs) {
    for (const entry of catalog.entries) {
      const pluginId = `${entry.name}@${catalog.name}`
      const installations = installed[pluginId] ?? []
      inventory.set(pluginId, {
        pluginId,
        name: entry.name,
        marketplace: catalog.name,
        catalogScope: catalog.scope,
        sourceKind: catalog.sourceKind,
        source: sourceDisplay(entry.source),
        description: entry.description,
        version: entry.version,
        author: entry.author?.name ?? catalog.owner,
        homepage: entry.homepage,
        repository: entry.repository,
        category: entry.category,
        tags: uniqueSorted([...(entry.tags ?? []), ...(entry.keywords ?? [])]),
        capabilities: uniqueSorted(
          entry.capabilities ?? [],
        ) as PluginDiscoveryCapability[],
        installed: installations.length > 0,
        installedScopes: uniqueSorted(installations.map(item => item.scope)),
        enabled: enabled.has(pluginId),
      })
    }
  }

  for (const plugin of input.loadedPlugins ?? []) {
    const pluginId = plugin.source
    const parsed = splitPluginId(pluginId)
    let target = inventory.get(pluginId)
    if (!target) {
      const installations = installed[pluginId] ?? []
      target = {
        pluginId,
        name: plugin.name || parsed.name,
        marketplace: parsed.marketplace,
        catalogScope: loadedPluginScope(plugin),
        sourceKind: plugin.isBuiltin ? 'builtin' : 'directory',
        source: plugin.path,
        tags: [],
        capabilities: [],
        installed: installations.length > 0 || !plugin.isBuiltin,
        installedScopes: uniqueSorted(
          installations.length > 0
            ? installations.map(item => item.scope)
            : [loadedPluginScope(plugin)],
        ),
        enabled: plugin.enabled ?? enabled.has(pluginId),
      }
      inventory.set(pluginId, target)
    }
    mergeLoadedPlugin(target, plugin)
  }

  // Keep orphaned installations discoverable even when their marketplace was
  // removed or failed to load. This is important for repair and uninstall.
  for (const [pluginId, installations] of Object.entries(installed)) {
    if (inventory.has(pluginId)) continue
    const parsed = splitPluginId(pluginId)
    inventory.set(pluginId, {
      pluginId,
      name: parsed.name,
      marketplace: parsed.marketplace,
      catalogScope: 'installed',
      sourceKind: 'installed-cache',
      source: installations[0]?.installPath ?? '',
      tags: [],
      capabilities: [],
      installed: installations.length > 0,
      installedScopes: uniqueSorted(installations.map(item => item.scope)),
      enabled: enabled.has(pluginId),
    })
  }

  return [...inventory.values()]
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
}

function scorePlugin(plugin: MutablePlugin, rawQuery: string): number | null {
  const query = normalized(rawQuery.trim())
  if (!query) return 0
  const tokens = uniqueSorted(query.split(/\s+/).filter(Boolean))
  const name = normalized(plugin.name)
  const pluginId = normalized(plugin.pluginId)
  const marketplace = normalized(plugin.marketplace)
  const category = normalized(plugin.category ?? '')
  const tags = plugin.tags.map(normalized)
  const capabilities = plugin.capabilities.map(normalized)
  const description = normalized(plugin.description ?? '')
  const searchable = [
    pluginId,
    name,
    marketplace,
    category,
    ...tags,
    ...capabilities,
    description,
  ].join('\n')

  if (!tokens.every(token => searchable.includes(token))) return null

  let score = 0
  if (pluginId === query) score += 1_200
  if (name === query) score += 1_000
  if (name.startsWith(query) && name !== query) score += 500
  if (pluginId.startsWith(query) && pluginId !== query) score += 350
  if (description.includes(query)) score += 80

  for (const token of tokens) {
    if (name.split(/[-_.]/).includes(token)) score += 180
    else if (name.includes(token)) score += 100
    if (tags.includes(token)) score += 140
    if (category === token) score += 120
    if (capabilities.includes(token)) score += 90
    if (marketplace.includes(token)) score += 40
    if (description.includes(token)) score += 10
  }
  if (plugin.installed) score += 5
  if (plugin.enabled) score += 2
  return score
}

function validLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PLUGIN_SEARCH_LIMIT) {
    throw new Error(
      `Plugin search limit must be an integer between 1 and ${MAX_PLUGIN_SEARCH_LIMIT}`,
    )
  }
  return limit
}

export function searchPluginInventory(
  input: PluginDiscoveryInput,
  options: PluginSearchOptions = {},
): PluginDiscoveryReport {
  const query = options.query?.trim() ?? ''
  if (query.length > MAX_PLUGIN_SEARCH_QUERY_LENGTH) {
    throw new Error(
      `Plugin search query must be at most ${MAX_PLUGIN_SEARCH_QUERY_LENGTH} characters`,
    )
  }
  const limit = validLimit(options.limit)
  const marketplace = options.marketplace?.trim()
  const inventory = buildPluginDiscoveryInventory(input)
  const ranked: PluginDiscoveryResult[] = []

  for (const plugin of inventory) {
    if (
      marketplace &&
      normalized(plugin.marketplace) !== normalized(marketplace)
    ) {
      continue
    }
    if (
      options.capability &&
      !plugin.capabilities.includes(options.capability)
    ) {
      continue
    }
    if (options.installedOnly && !plugin.installed) continue
    const score = scorePlugin(plugin, query)
    if (score === null) continue
    ranked.push({ ...plugin, score })
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.installed) - Number(a.installed) ||
      a.pluginId.localeCompare(b.pluginId),
  )
  const total = ranked.length
  const results = ranked.slice(0, limit)

  return {
    query,
    filters: {
      capability: options.capability,
      marketplace: marketplace || undefined,
      installedOnly: options.installedOnly ?? false,
    },
    catalogsSearched: input.catalogs.length,
    total,
    returned: results.length,
    truncated: total > results.length,
    results,
    failures: (input.failures ?? []).map(failure => ({
      catalog: failure.catalog,
      error: failure.error.slice(0, 500),
    })),
  }
}

function compact(value: string | undefined, max = 240): string | undefined {
  if (!value) return undefined
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

export function formatPluginDiscoveryReport(
  report: PluginDiscoveryReport,
): string {
  const target = report.query ? ` for "${report.query}"` : ''
  const lines = [
    `Plugin search: ${report.total} ${report.total === 1 ? 'match' : 'matches'}${target} across ${report.catalogsSearched} ${report.catalogsSearched === 1 ? 'catalog' : 'catalogs'}`,
  ]

  if (report.results.length === 0) {
    lines.push(
      'No matching plugins. Try a broader query or remove capability/marketplace filters.',
    )
  }

  for (const [index, plugin] of report.results.entries()) {
    const state = plugin.installed
      ? plugin.enabled
        ? 'installed, enabled'
        : 'installed, disabled'
      : 'available'
    lines.push('', `${index + 1}. ${plugin.pluginId} (${state})`)
    const description = compact(plugin.description)
    if (description) lines.push(`   ${description}`)
    if (plugin.capabilities.length > 0) {
      lines.push(`   Capabilities: ${plugin.capabilities.join(', ')}`)
    }
    lines.push(
      `   Catalog: ${plugin.marketplace} (${plugin.catalogScope}; ${plugin.sourceKind})`,
    )
    if (!plugin.installed && !plugin.pluginId.endsWith('@builtin')) {
      lines.push(`   Install: ur plugin install ${plugin.pluginId}`)
    }
  }

  if (report.truncated) {
    lines.push(
      '',
      `Showing ${report.returned} of ${report.total}; increase --limit up to ${MAX_PLUGIN_SEARCH_LIMIT}.`,
    )
  }
  if (report.failures.length > 0) {
    lines.push(
      '',
      `Warning: ${report.failures.length} ${report.failures.length === 1 ? 'catalog was' : 'catalogs were'} unavailable: ${report.failures.map(item => item.catalog).join(', ')}`,
    )
  }
  return lines.join('\n')
}

export function formatPluginDetail(plugin: PluginDiscoveryResult): string {
  const lines = [
    `${plugin.pluginId}${plugin.version ? ` v${plugin.version}` : ''}`,
    compact(plugin.description, 500) ?? 'No description provided.',
    '',
    `Status: ${plugin.installed ? (plugin.enabled ? 'installed and enabled' : 'installed and disabled') : 'available'}`,
    `Catalog: ${plugin.marketplace} (${plugin.catalogScope}; ${plugin.sourceKind})`,
    `Source: ${plugin.source}`,
  ]
  if (plugin.installedScopes.length > 0)
    lines.push(`Installed scopes: ${plugin.installedScopes.join(', ')}`)
  if (plugin.author) lines.push(`Author: ${plugin.author}`)
  if (plugin.category) lines.push(`Category: ${plugin.category}`)
  if (plugin.tags.length > 0) lines.push(`Tags: ${plugin.tags.join(', ')}`)
  if (plugin.capabilities.length > 0)
    lines.push(`Capabilities: ${plugin.capabilities.join(', ')}`)
  if (plugin.homepage) lines.push(`Homepage: ${plugin.homepage}`)
  if (plugin.repository) lines.push(`Repository: ${plugin.repository}`)
  if (!plugin.installed && !plugin.pluginId.endsWith('@builtin')) {
    lines.push('', `Install with: ur plugin install ${plugin.pluginId}`)
  }
  return lines.join('\n')
}
