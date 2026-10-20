import { describe, expect, test } from 'bun:test'
import { reconcileBundledMarketplace } from '../src/utils/plugins/nativeMarketplace.js'
import type { KnownMarketplacesFile } from '../src/utils/plugins/schemas.js'

const custom: KnownMarketplacesFile = {
  company: {
    source: { source: 'github', repo: 'company/approved-tools' },
    installLocation: '/company/cache',
    lastUpdated: '2026-01-01T00:00:00Z',
    autoUpdate: false,
  },
}

describe('native offline marketplace registration', () => {
  test('adds the local catalog and preserves unrelated marketplaces without enabling plugins', () => {
    const result = reconcileBundledMarketplace(custom, '/installed/resources/marketplace')
    expect(result.changed).toBe(true)
    expect(result.config.company).toEqual(custom.company)
    expect(result.config['ur-plugins-official']).toMatchObject({
      source: { source: 'directory', path: '/installed/resources/marketplace' },
      installLocation: '/installed/resources/marketplace',
      autoUpdate: false,
    })
    expect(Object.keys(result.config).sort()).toEqual(['company', 'ur-plugins-official'])
    expect(custom['ur-plugins-official']).toBeUndefined()
  })

  test('updates an owned catalog during upgrades and is idempotent', () => {
    const first = reconcileBundledMarketplace(custom, '/versions/1/resources/marketplace')
    const next = reconcileBundledMarketplace(first.config, '/versions/2/resources/marketplace', '/versions/1/resources/marketplace')
    expect(next.changed).toBe(true)
    expect(next.config.company).toEqual(custom.company)
    expect(next.config['ur-plugins-official']?.installLocation).toBe('/versions/2/resources/marketplace')
    expect(reconcileBundledMarketplace(next.config, '/versions/2/resources/marketplace', '/versions/2/resources/marketplace').changed).toBe(false)
  })

  test('never overwrites a user source or explicit settings declaration', () => {
    const existing: KnownMarketplacesFile = {
      ...custom,
      'ur-plugins-official': { ...custom.company!, source: { source: 'github', repo: 'Maitham16/UR' } },
    }
    expect(reconcileBundledMarketplace(existing, '/installed/resources/marketplace').config).toBe(existing)
    const directoryOverride: KnownMarketplacesFile = {
      ...custom,
      'ur-plugins-official': { ...custom.company!, source: { source: 'directory', path: '/my/tools' } },
    }
    expect(reconcileBundledMarketplace(directoryOverride, '/installed/resources/marketplace', '/old/native/catalog').config).toBe(directoryOverride)
    expect(reconcileBundledMarketplace(custom, '/installed/resources/marketplace', undefined, true).changed).toBe(false)
  })
})
