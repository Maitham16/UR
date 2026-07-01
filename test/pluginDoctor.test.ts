import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  discoverPluginDirs,
  doctorPluginDir,
  formatPluginDoctor,
  runPluginDoctor,
} from '../src/utils/plugins/pluginDoctor.js'

function writePlugin(root: string, name: string, manifest: unknown): string {
  const dir = join(root, name)
  mkdirSync(join(dir, '.ur-plugin'), { recursive: true })
  writeFileSync(join(dir, '.ur-plugin', 'plugin.json'), JSON.stringify(manifest))
  return dir
}

describe('plugin doctor', () => {
  test('validates the shipped bundled plugins (plugins/core)', () => {
    const report = runPluginDoctor([join(process.cwd(), 'plugins', 'core')])
    expect(report.scanned).toBeGreaterThan(5)
    const names = report.plugins.map(p => p.name)
    expect(names).toContain('engineering-discipline')
    // Every shipped manifest must be valid — this is a real guard on the repo.
    const invalid = report.plugins.filter(p => !p.ok)
    expect(invalid.map(p => `${p.name}: ${p.errors.join(';')}`)).toEqual([])
    expect(report.ok).toBe(true)
  })

  test('reports declared capabilities for a plugin', () => {
    const entry = report_engineering()
    expect(entry?.capabilities).toContain('skills')
    expect(entry?.capabilities).toContain('validators')
    function report_engineering() {
      return runPluginDoctor([join(process.cwd(), 'plugins', 'core')]).plugins.find(
        p => p.name === 'engineering-discipline',
      )
    }
  })

  test('rejects an invalid manifest with clear errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-plugindoctor-'))
    try {
      const dir = writePlugin(root, 'bad', { description: 'no name or version' })
      const entry = doctorPluginDir(dir)
      expect(entry.ok).toBe(false)
      expect(entry.errors.length).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('missing manifest is reported, not crashed', () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-plugindoctor-'))
    try {
      mkdirSync(join(root, 'empty'), { recursive: true })
      const entry = doctorPluginDir(join(root, 'empty'))
      expect(entry.ok).toBe(false)
      expect(entry.errors[0]).toContain('Missing')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('discovers plugin dirs and a broken plugin does not fail the whole scan', () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-plugindoctor-'))
    try {
      writePlugin(root, 'good', { name: 'good', version: '1.0.0', description: 'ok' })
      writePlugin(root, 'broken', { version: 'x' })
      const dirs = discoverPluginDirs([root])
      expect(dirs.length).toBe(2)
      const report = runPluginDoctor([root])
      expect(report.plugins.find(p => p.name === 'good')?.ok).toBe(true)
      expect(report.ok).toBe(false)
      expect(formatPluginDoctor(report)).toContain('issues found')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
