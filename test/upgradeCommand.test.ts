import { describe, expect, test } from 'bun:test'
import {
  checkUpgradeStatus,
  parseNpmVersion,
} from '../src/cli/update.js'

describe('ur upgrade command', () => {
  test('prints a clean development-build message without checking npm', async () => {
    let checkedRegistry = false
    const result = await checkUpgradeStatus({
      currentVersion: '1.24.0',
      installationType: 'development',
      latestVersion: async () => {
        checkedRegistry = true
        return { ok: true, version: '1.25.0' }
      },
    })

    expect(checkedRegistry).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('development')
    expect(result.output).toContain(
      'Development build detected. To update, pull latest source or install from npm.',
    )
  })

  test('checks npm-installed builds against ur-agent on npm', async () => {
    const result = await checkUpgradeStatus({
      currentVersion: '1.24.0',
      installationType: 'npm-global',
      latestVersion: async () => ({ ok: true, version: '1.24.0' }),
    })

    expect(result.output[1]).toBe('Checking for updates to ur-agent...')
    expect(result.status).toBe('up-to-date')
  })

  test('reports update available with the exact install command', async () => {
    const result = await checkUpgradeStatus({
      currentVersion: '1.23.3',
      installationType: 'npm-global',
      latestVersion: async () => ({ ok: true, version: '1.24.0' }),
    })

    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('update-available')
    expect(result.output).toContain('Update available: 1.23.3 -> 1.24.0')
    expect(result.output).toContain('Run: npm install -g ur-agent@latest')
  })

  test('reports already latest', async () => {
    const result = await checkUpgradeStatus({
      currentVersion: '1.24.0',
      installationType: 'npm-local',
      latestVersion: async () => ({ ok: true, version: '1.24.0' }),
    })

    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('up-to-date')
    expect(result.output).toContain('UR-AGENT is up to date.')
  })

  test('reports registry or network failures concisely', async () => {
    const result = await checkUpgradeStatus({
      currentVersion: '1.24.0',
      installationType: 'npm-global',
      latestVersion: async () => ({ ok: false, reason: 'registry-failure' }),
    })

    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('registry-failure')
    expect(result.output).toContain(
      'Unable to check npm registry for ur-agent. Check your network and try again.',
    )
  })

  test('reports malformed registry responses', async () => {
    expect(parseNpmVersion('not-a-version')).toBeNull()
    expect(parseNpmVersion('v1.24.0')).toBe('1.24.0')

    const result = await checkUpgradeStatus({
      currentVersion: '1.24.0',
      installationType: 'npm-global',
      latestVersion: async () => ({ ok: false, reason: 'malformed-response' }),
    })

    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('malformed-response')
    expect(result.output).toContain(
      'npm registry returned an invalid version for ur-agent.',
    )
  })
})
