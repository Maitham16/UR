import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setInlinePlugins } from '../src/bootstrap/state.js'
import {
  clearPluginCommandCache,
  getPluginCommands,
} from '../src/utils/plugins/loadPluginCommands.js'
import { clearPluginCache } from '../src/utils/plugins/pluginLoader.js'
import { checkPathSafetyForAutoEdit } from '../src/utils/permissions/filesystem.js'
import { parseSettingsFile } from '../src/utils/settings/settings.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'

describe('retired public surfaces', () => {
  test('removes the token-budget CLI flag while retaining the environment bridge', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '..', 'src', 'main.tsx'),
      'utf8',
    )
    expect(source).not.toContain('--max-thinking-tokens')
    expect(source).toContain('process.env.MAX_THINKING_TOKENS')
  })

  test('migrates top-level disableAutoMode into permissions and removes the old key', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ur-settings-migration-'))
    const path = join(tmp, 'settings.json')
    writeFileSync(
      path,
      JSON.stringify({
        disableAutoMode: 'disable',
        permissions: { allow: ['Read'] },
      }),
    )

    try {
      resetSettingsCache()
      const { settings, errors } = parseSettingsFile(path)
      expect(errors).toEqual([])
      expect(settings?.permissions?.disableAutoMode).toBe('disable')
      expect(
        (settings as Record<string, unknown> | null)?.disableAutoMode,
      ).toBeUndefined()
    } finally {
      resetSettingsCache()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('drops invalid values for the removed top-level setting', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ur-settings-migration-'))
    const path = join(tmp, 'settings.json')
    writeFileSync(path, JSON.stringify({ disableAutoMode: false }))

    try {
      resetSettingsCache()
      const { settings, errors } = parseSettingsFile(path)
      expect(errors).toEqual([])
      expect(
        (settings as Record<string, unknown> | null)?.disableAutoMode,
      ).toBeUndefined()
      expect(settings?.permissions?.disableAutoMode).toBeUndefined()
    } finally {
      resetSettingsCache()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('keeps manifest-backed plugin commands available', async () => {
    const pluginRoot = resolve(import.meta.dir, '..', 'plugins', 'core', 'hello')
    setInlinePlugins([pluginRoot])
    clearPluginCache('deprecated-surface plugin command test')
    clearPluginCommandCache()

    try {
      const commands = await getPluginCommands()
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: 'prompt',
          name: 'hello:hello',
          source: 'plugin',
        }),
      )
    } finally {
      setInlinePlugins([])
      clearPluginCache('deprecated-surface plugin command test cleanup')
      clearPluginCommandCache()
    }
  })

  test('treats retired .ur/commands files as ordinary project content', () => {
    const retiredCommand = resolve('.ur', 'commands', 'old-command.md')
    expect(
      checkPathSafetyForAutoEdit(retiredCommand, [retiredCommand]),
    ).toEqual({ safe: true })
  })
})
