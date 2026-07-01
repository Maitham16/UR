import { describe, expect, test } from 'bun:test'
import {
  formatIdeConfig,
  formatIdeDoctor,
  formatIdeStatus,
  generateIdeConfig,
  ideDoctorChecks,
  IDE_TARGETS,
  resolveIdeTarget,
  type IdeStatus,
} from '../src/services/agents/ideConfig.js'
import { runIdeInfoCommand } from '../src/commands/ide/ideInfoCommand.js'

describe('IDE config generation', () => {
  test('every target resolves and generates config', () => {
    for (const target of IDE_TARGETS) {
      expect(resolveIdeTarget(target.id)?.id).toBe(target.id)
      const config = generateIdeConfig(target.id)
      expect(config.label).toBe(target.label)
      expect(config.summary.length).toBeGreaterThan(0)
      expect(config.steps.length).toBeGreaterThan(0)
    }
  })

  test('Zed generates real stdio ACP settings pointing at ur acp stdio', () => {
    const config = generateIdeConfig('zed')
    expect(config.kind).toBe('stdio-acp')
    const settings = config.files.find(f => f.path === '.zed/settings.json')
    expect(settings).toBeDefined()
    const parsed = JSON.parse(settings!.content)
    expect(parsed.agent_servers.UR.command).toBe('ur')
    expect(parsed.agent_servers.UR.args).toEqual(['acp', 'stdio'])
  })

  test('VS Code family is native-extension, JetBrains is manual', () => {
    expect(generateIdeConfig('vscode').kind).toBe('native-extension')
    expect(generateIdeConfig('cursor').kind).toBe('native-extension')
    expect(generateIdeConfig('windsurf').kind).toBe('native-extension')
    expect(generateIdeConfig('jetbrains').kind).toBe('manual')
    expect(generateIdeConfig('jetbrains').files).toEqual([])
  })

  test('generic-acp documents HTTP is not stdio ACP (no fake claim)', () => {
    const config = generateIdeConfig('generic-acp')
    expect(config.limitations.join(' ')).toContain('not Zed-style stdio ACP')
  })

  test('aliases resolve (nvim, intellij, code)', () => {
    expect(resolveIdeTarget('nvim')?.id).toBe('neovim')
    expect(resolveIdeTarget('intellij')?.id).toBe('jetbrains')
    expect(resolveIdeTarget('code')?.id).toBe('vscode')
    expect(resolveIdeTarget('nonsense')).toBeNull()
  })

  test('custom command is threaded into generated config', () => {
    const config = generateIdeConfig('zed', { command: '/opt/ur/bin/ur' })
    const parsed = JSON.parse(config.files[0]!.content)
    expect(parsed.agent_servers.UR.command).toBe('/opt/ur/bin/ur')
  })
})

describe('IDE status + doctor formatting', () => {
  const status: IdeStatus = {
    workspaceRoot: '/work/project',
    acp: { running: true, port: 8123, host: '127.0.0.1' },
    provider: { label: 'Codex CLI', model: 'codex/gpt-5.5', runtimeBackend: 'subscription-cli:codex', authLabel: 'subscription', ready: true },
    pluginCount: 3,
    detectedIdes: [{ name: 'VS Code', connected: false }],
    warnings: [],
  }

  test('status shows workspace, server, provider/model, plugin count', () => {
    const text = formatIdeStatus(status)
    expect(text).toContain('Workspace: /work/project')
    expect(text).toContain('running on 127.0.0.1:8123')
    expect(text).toContain('Codex CLI')
    expect(text).toContain('codex/gpt-5.5')
    expect(text).toContain('Plugins loaded: 3')
  })

  test('doctor reports missing config clearly (no workspace + acp down)', () => {
    const bad: IdeStatus = {
      ...status,
      workspaceRoot: '',
      acp: { running: false, port: null, host: '127.0.0.1' },
      provider: { ...status.provider, ready: false, model: undefined },
    }
    const checks = ideDoctorChecks(bad)
    expect(checks.find(c => c.name === 'workspace')?.status).toBe('fail')
    expect(checks.find(c => c.name === 'acp')?.message).toContain('ur acp')
    expect(formatIdeDoctor(bad)).toContain('not ready')
  })
})

describe('runIdeInfoCommand routing', () => {
  test('config <zed> returns Zed settings', async () => {
    const out = await runIdeInfoCommand('config zed')
    expect(out).toContain('.zed/settings.json')
    expect(out).toContain('acp')
  })

  test('config with no target lists options', async () => {
    const out = await runIdeInfoCommand('config')
    expect(out).toContain('zed')
    expect(out).toContain('vscode')
  })

  test('config unknown target errors clearly', async () => {
    const out = await runIdeInfoCommand('config emacs')
    expect(out).toContain('Unknown IDE')
  })

  test('status --json is valid JSON with expected shape', async () => {
    const out = await runIdeInfoCommand('status --json', '/tmp/some-workspace')
    const parsed = JSON.parse(out)
    expect(parsed.workspaceRoot).toBe('/tmp/some-workspace')
    expect(parsed).toHaveProperty('acp')
    expect(parsed).toHaveProperty('pluginCount')
  })
})
