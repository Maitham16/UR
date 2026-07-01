// Smoke test for the in-repo marketplace tree.
//
// Catches drift between the shipped .ur-plugin/marketplace.json and the
// PluginMarketplaceSchema, and confirms the example plugin's manifest
// passes PluginManifestSchema. If either drifts, real users hitting the
// auto-install on startup would see a parse error — we want this to
// surface in CI instead.

import { describe, expect, test } from 'bun:test'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PluginManifestSchema,
  PluginMarketplaceSchema,
} from '../src/utils/plugins/schemas'

const REPO = join(import.meta.dir, '..')

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async entry => {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) return listMarkdownFiles(fullPath)
      return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : []
    }),
  )
  return files.flat()
}

describe('repo marketplace tree', () => {
  test('.ur-plugin/marketplace.json parses against PluginMarketplaceSchema', async () => {
    const raw = await readFile(
      join(REPO, '.ur-plugin', 'marketplace.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw)
    const result = PluginMarketplaceSchema().safeParse(parsed)
    if (!result.success) {
      throw new Error(
        `marketplace.json invalid: ${JSON.stringify(result.error.format(), null, 2)}`,
      )
    }
    expect(result.data.name).toBe('ur-plugins-official')
    expect(result.data.plugins.length).toBeGreaterThan(0)
  })

  test('official marketplace advertises standard agent extension capabilities', async () => {
    const raw = await readFile(
      join(REPO, '.ur-plugin', 'marketplace.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw)
    const result = PluginMarketplaceSchema().safeParse(parsed)
    if (!result.success) {
      throw new Error(
        `marketplace.json invalid: ${JSON.stringify(result.error.format(), null, 2)}`,
      )
    }
    const capabilities = new Set(
      result.data.plugins.flatMap(plugin => plugin.capabilities ?? []),
    )
    expect([...capabilities]).toEqual(
      expect.arrayContaining([
        'mcp-tools',
        'skills',
        'templates',
        'validators',
        'language-adapters',
      ]),
    )

    const reference = result.data.plugins.find(
      plugin => plugin.name === 'engineering-discipline',
    )
    expect(reference?.capabilities).toEqual(
      expect.arrayContaining([
        'commands',
        'skills',
        'templates',
        'validators',
        'language-adapters',
        'lsp-servers',
      ]),
    )
  })

  test('hello plugin manifest parses against PluginManifestSchema', async () => {
    const raw = await readFile(
      join(REPO, 'marketplace-plugins', 'hello', '.ur-plugin', 'plugin.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw)
    const result = PluginManifestSchema().safeParse(parsed)
    if (!result.success) {
      throw new Error(
        `hello plugin.json invalid: ${JSON.stringify(result.error.format(), null, 2)}`,
      )
    }
    expect(result.data.name).toBe('hello')
  })

  test('marketplace entries point at directories that exist', async () => {
    const raw = await readFile(
      join(REPO, '.ur-plugin', 'marketplace.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw) as {
      plugins: Array<{ name: string; source: string }>
    }
    for (const entry of parsed.plugins) {
      // Only validate inline relative-path sources here. Other source
      // kinds (npm, github, url, …) are out of scope for this smoke test.
      if (typeof entry.source !== 'string') continue
      if (!entry.source.startsWith('./')) continue
      const dir = join(REPO, entry.source)
      // Read the directory's plugin.json — fail loudly if missing.
      await readFile(join(dir, '.ur-plugin', 'plugin.json'), 'utf8')
    }
  })

  test('every plugin manifest parses against PluginManifestSchema', async () => {
    const raw = await readFile(
      join(REPO, '.ur-plugin', 'marketplace.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw) as {
      plugins: Array<{ name: string; source: string }>
    }
    for (const entry of parsed.plugins) {
      if (typeof entry.source !== 'string' || !entry.source.startsWith('./')) {
        continue
      }
      const manifestRaw = await readFile(
        join(REPO, entry.source, '.ur-plugin', 'plugin.json'),
        'utf8',
      )
      const manifest = JSON.parse(manifestRaw)
      const result = PluginManifestSchema().safeParse(manifest)
      if (!result.success) {
        throw new Error(
          `${entry.name} plugin.json invalid: ${JSON.stringify(result.error.format(), null, 2)}`,
        )
      }
      expect(result.data.name).toBe(entry.name)
    }
  })

  test('engineering-discipline reference plugin ships every marketplace extension surface', async () => {
    const root = join(REPO, 'marketplace-plugins', 'engineering-discipline')
    const manifestRaw = await readFile(
      join(root, '.ur-plugin', 'plugin.json'),
      'utf8',
    )
    const manifest = JSON.parse(manifestRaw)
    const result = PluginManifestSchema().safeParse(manifest)
    if (!result.success) {
      throw new Error(
        `engineering-discipline plugin.json invalid: ${JSON.stringify(result.error.format(), null, 2)}`,
      )
    }

    expect(result.data.skills).toBe('./skills')
    expect(result.data.templates).toBe('./templates')
    expect(result.data.validators).toBe('./validators')
    expect(Object.keys(result.data.languageAdapters ?? {})).toContain('markdown')
    expect(Object.keys(result.data.lspServers ?? {})).toContain('markdown')

    await stat(join(root, 'commands', 'discipline-check.md'))
    await stat(join(root, 'skills', 'reproducible-release', 'SKILL.md'))
    await stat(join(root, 'templates', 'release-verifier.md'))
    await stat(join(root, 'validators', 'release-gate.json'))
  })

  test('every plugin command markdown file has frontmatter', async () => {
    const raw = await readFile(
      join(REPO, '.ur-plugin', 'marketplace.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw) as {
      plugins: Array<{ name: string; source: string }>
    }
    for (const entry of parsed.plugins) {
      if (typeof entry.source !== 'string' || !entry.source.startsWith('./')) {
        continue
      }
      const commandFiles = await listMarkdownFiles(
        join(REPO, entry.source, 'commands'),
      )
      expect(commandFiles.length).toBeGreaterThan(0)
      for (const cmdPath of commandFiles) {
        const content = await readFile(cmdPath, 'utf8')
        expect(content.startsWith('---\n')).toBe(true)
        expect(content).toContain('description:')
      }
    }
  })
})
