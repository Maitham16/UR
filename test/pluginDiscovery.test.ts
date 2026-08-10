import { describe, expect, test } from 'bun:test'
import type { LoadedPlugin } from '../src/types/plugin.js'
import {
  buildPluginDiscoveryInventory,
  formatPluginDetail,
  formatPluginDiscoveryReport,
  searchPluginInventory,
  type PluginDiscoveryInput,
} from '../src/utils/plugins/pluginDiscovery.js'

function fixture(): PluginDiscoveryInput {
  return {
    catalogs: [
      {
        name: 'workspace-tools',
        scope: 'workspace',
        sourceKind: 'directory',
        owner: 'Example Team',
        entries: [
          {
            name: 'git-summary',
            source: './plugins/git-summary',
            description: 'Summarize recent commits and working tree changes.',
            version: '1.2.0',
            category: 'workflow',
            tags: ['git', 'standup'],
            capabilities: ['commands'],
            strict: true,
          },
          {
            name: 'review-suite',
            source: './plugins/review-suite',
            description: 'Review git changes with deterministic validators.',
            category: 'quality',
            tags: ['git', 'review'],
            capabilities: ['commands', 'validators'],
            strict: true,
          },
        ],
      },
      {
        name: 'personal-tools',
        scope: 'personal',
        sourceKind: 'url',
        entries: [
          {
            name: 'git-helper',
            source: {
              source: 'url',
              url: 'https://token:secret@example.test/plugin.git?access_token=query-secret&view=1#fragment-secret',
            },
            description: 'Personal git helper.',
            capabilities: ['skills'],
            strict: true,
          },
        ],
      },
    ],
    installed: {
      'git-summary@workspace-tools': [
        {
          scope: 'project',
          version: '1.2.0',
          installPath: '/tmp/git-summary',
          installedAt: '2026-08-01T00:00:00.000Z',
          projectPath: '/workspace',
        },
      ],
    },
    enabledPluginIds: ['git-summary@workspace-tools'],
    failures: [{ catalog: 'offline-tools', error: 'timed out' }],
  }
}

describe('plugin discovery', () => {
  test('ranks exact names ahead of description-only matches', () => {
    const report = searchPluginInventory(fixture(), { query: 'git-summary' })
    expect(report.results[0]?.pluginId).toBe('git-summary@workspace-tools')
    expect(report.results[0]?.installed).toBe(true)
    expect(report.results[0]?.enabled).toBe(true)
  })

  test('uses AND token matching and deterministic capability filters', () => {
    const report = searchPluginInventory(fixture(), {
      query: 'git review',
      capability: 'validators',
    })
    expect(report.results.map(item => item.pluginId)).toEqual([
      'review-suite@workspace-tools',
    ])
    expect(report.filters.capability).toBe('validators')
  })

  test('supports installed-only, marketplace, and bounded result filters', () => {
    const installed = searchPluginInventory(fixture(), {
      installedOnly: true,
      marketplace: 'WORKSPACE-TOOLS',
      limit: 1,
    })
    expect(installed.results).toHaveLength(1)
    expect(installed.results[0]?.pluginId).toBe(
      'git-summary@workspace-tools',
    )

    const bounded = searchPluginInventory(fixture(), { query: 'git', limit: 2 })
    expect(bounded.total).toBe(3)
    expect(bounded.returned).toBe(2)
    expect(bounded.truncated).toBe(true)
  })

  test('merges installed manifests without duplicating catalog entries', () => {
    const loaded: LoadedPlugin = {
      name: 'git-summary',
      source: 'git-summary@workspace-tools',
      repository: 'git-summary@workspace-tools',
      path: '/tmp/git-summary',
      enabled: true,
      manifest: {
        name: 'git-summary',
        version: '1.2.1',
        description: 'Canonical installed description.',
        keywords: ['installed-keyword'],
        commands: './commands',
        skills: './skills',
      },
    }
    const input = fixture()
    input.loadedPlugins = [loaded]
    const inventory = buildPluginDiscoveryInventory(input)
    const result = inventory.filter(
      item => item.pluginId === 'git-summary@workspace-tools',
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.version).toBe('1.2.1')
    expect(result[0]?.tags).toContain('installed-keyword')
    expect(result[0]?.capabilities).toEqual(['commands', 'skills'])
  })

  test('keeps orphaned installations discoverable for repair', () => {
    const input = fixture()
    input.installed!['orphan@removed-market'] = [
      {
        scope: 'user',
        installPath: '/tmp/orphan',
        installedAt: '2026-08-01T00:00:00.000Z',
      },
    ]
    const report = searchPluginInventory(input, { query: 'orphan' })
    expect(report.results[0]).toMatchObject({
      pluginId: 'orphan@removed-market',
      catalogScope: 'installed',
      installed: true,
      installedScopes: ['user'],
    })
  })

  test('redacts credentials from source metadata', () => {
    const report = searchPluginInventory(fixture(), { query: 'git-helper' })
    expect(report.results[0]?.source).not.toContain('secret')
    expect(report.results[0]?.source).toContain('example.test')
    expect(report.results[0]?.source).toContain('access_token=%5Bredacted%5D')
    expect(report.results[0]?.source).toContain('view=1')
  })

  test('formats human search and detail output with actionable install hints', () => {
    const report = searchPluginInventory(fixture(), { query: 'review-suite' })
    const output = formatPluginDiscoveryReport(report)
    expect(output).toContain('review-suite@workspace-tools')
    expect(output).toContain(
      'Install: ur plugin install review-suite@workspace-tools',
    )
    expect(output).toContain('offline-tools')
    expect(formatPluginDetail(report.results[0]!)).toContain(
      'Capabilities: commands, validators',
    )
  })

  test('rejects abusive query and limit sizes', () => {
    expect(() =>
      searchPluginInventory(fixture(), { query: 'x'.repeat(201) }),
    ).toThrow('at most 200 characters')
    expect(() => searchPluginInventory(fixture(), { limit: 101 })).toThrow(
      'between 1 and 100',
    )
  })
})
