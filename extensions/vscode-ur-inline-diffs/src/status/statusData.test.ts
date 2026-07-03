import { describe, expect, test } from 'bun:test'
import { assembleAgentStatus, parseIdeStatusJson, parseProviderStatusJson } from './statusData.js'

describe('parseIdeStatusJson', () => {
  test('reads a full status payload', () => {
    const raw = JSON.stringify({
      workspaceRoot: '/work/project',
      acp: { running: true, port: 8123, host: '127.0.0.1' },
      provider: { label: 'Codex CLI', model: 'codex/gpt-5.5' },
      pluginCount: 3,
      warnings: ['low disk space'],
      sandboxMode: 'recommended',
      verifierMode: 'strict',
    })
    const parsed = parseIdeStatusJson(raw)
    expect(parsed.workspaceRoot).toBe('/work/project')
    expect(parsed.acp).toEqual({ running: true, port: 8123, host: '127.0.0.1' })
    expect(parsed.pluginCount).toBe(3)
    expect(parsed.warnings).toEqual(['low disk space'])
    expect(parsed.sandboxMode).toBe('recommended')
    expect(parsed.verifierMode).toBe('strict')
    expect(parsed.providerLabel).toBe('Codex CLI')
    expect(parsed.providerModel).toBe('codex/gpt-5.5')
  })

  test('missing sandboxMode/verifierMode renders as unknown, not guessed (pre-PR3 CLI)', () => {
    const raw = JSON.stringify({
      workspaceRoot: '/work/project',
      acp: { running: false, port: null, host: '127.0.0.1' },
      provider: { label: 'Ollama' },
      pluginCount: 0,
      warnings: [],
    })
    const parsed = parseIdeStatusJson(raw)
    expect(parsed.sandboxMode).toBe('unknown')
    expect(parsed.verifierMode).toBe('unknown')
  })

  test('invalid enum values fall back to unknown rather than being trusted verbatim', () => {
    const raw = JSON.stringify({ sandboxMode: 'nonsense', verifierMode: 42 })
    const parsed = parseIdeStatusJson(raw)
    expect(parsed.sandboxMode).toBe('unknown')
    expect(parsed.verifierMode).toBe('unknown')
  })

  test('malformed JSON never throws and falls back to the provided workspace root', () => {
    expect(() => parseIdeStatusJson('not json', '/fallback/root')).not.toThrow()
    const parsed = parseIdeStatusJson('not json', '/fallback/root')
    expect(parsed.workspaceRoot).toBe('/fallback/root')
    expect(parsed.providerLabel).toBe('Unknown provider')
    expect(parsed.warnings).toEqual([])
  })
})

describe('parseProviderStatusJson', () => {
  test('reads a full provider status payload', () => {
    const raw = JSON.stringify({
      provider: 'claude-code-cli',
      providerKind: 'subscription-cli',
      usesExternalCli: true,
      supportsNativeToolCalls: false,
      supportsNativeStreaming: false,
      safetyBoundaryLabel: 'External vendor CLI boundary: UR passes prompt text to the official CLI...',
    })
    const parsed = parseProviderStatusJson(raw)
    expect(parsed.providerId).toBe('claude-code-cli')
    expect(parsed.providerKind).toBe('subscription-cli')
    expect(parsed.usesExternalCli).toBe(true)
    expect(parsed.supportsNativeToolCalls).toBe(false)
    expect(parsed.supportsNativeStreaming).toBe(false)
    expect(parsed.safetyBoundaryLabel).toContain('External vendor CLI boundary')
  })

  test('unknown capability renders as the string "unknown", never guessed', () => {
    const parsed = parseProviderStatusJson('{}')
    expect(parsed.providerKind).toBe('unknown')
    expect(parsed.usesExternalCli).toBe('unknown')
    expect(parsed.supportsNativeToolCalls).toBe('unknown')
    expect(parsed.supportsNativeStreaming).toBe('unknown')
    expect(parsed.safetyBoundaryLabel).toBeUndefined()
  })

  test('malformed JSON never throws', () => {
    expect(() => parseProviderStatusJson('{not json')).not.toThrow()
    expect(parseProviderStatusJson('{not json').providerKind).toBe('unknown')
  })
})

describe('assembleAgentStatus', () => {
  test('happy path composes ide + provider + version into one AgentStatus', async () => {
    const runCli = async (args: string[]) => {
      if (args[0] === 'ide') {
        return {
          stdout: JSON.stringify({
            workspaceRoot: '/work/project',
            acp: { running: true, port: 8123, host: '127.0.0.1' },
            provider: { label: 'Claude API', model: 'claude-opus-4' },
            pluginCount: 2,
            warnings: [],
            sandboxMode: 'required',
            verifierMode: 'strict',
          }),
          stderr: '',
        }
      }
      if (args[0] === 'provider') {
        return {
          stdout: JSON.stringify({
            provider: 'anthropic-api',
            providerKind: 'ur-native',
            usesExternalCli: false,
            supportsNativeToolCalls: true,
            supportsNativeStreaming: true,
            safetyBoundaryLabel: 'UR-native runtime: UR owns provider request shaping...',
          }),
          stderr: '',
        }
      }
      return { stdout: '1.36.1 (UR-AGENT)\n', stderr: '' }
    }

    const status = await assembleAgentStatus('/work/project', runCli)
    expect(status.urVersion).toBe('1.36.1 (UR-AGENT)')
    expect(status.workspaceRoot).toBe('/work/project')
    expect(status.acp.running).toBe(true)
    expect(status.provider.label).toBe('Claude API')
    expect(status.provider.model).toBe('claude-opus-4')
    expect(status.provider.providerKind).toBe('ur-native')
    expect(status.provider.supportsNativeToolCalls).toBe(true)
    expect(status.provider.multimodal).toBe(true)
    expect(status.sandboxMode).toBe('required')
    expect(status.verifierMode).toBe('strict')
    expect(status.pluginCount).toBe(2)
    expect(status.warnings).toEqual([])
  })

  test('subscription-cli provider gets multimodal=false and carries the boundary label', async () => {
    const runCli = async (args: string[]) => {
      if (args[0] === 'ide') return { stdout: JSON.stringify({ workspaceRoot: '/w', provider: {} }), stderr: '' }
      if (args[0] === 'provider') {
        return {
          stdout: JSON.stringify({
            provider: 'codex-cli',
            providerKind: 'subscription-cli',
            usesExternalCli: true,
            supportsNativeToolCalls: false,
            supportsNativeStreaming: false,
            safetyBoundaryLabel: 'External vendor CLI boundary: UR passes prompt text to the official CLI...',
          }),
          stderr: '',
        }
      }
      return { stdout: '1.36.1', stderr: '' }
    }
    const status = await assembleAgentStatus('/w', runCli)
    expect(status.provider.multimodal).toBe(false)
    expect(status.provider.safetyBoundaryLabel).toContain('External vendor CLI boundary')
  })

  test('a failing CLI call degrades to unknown fields and a warning, never throws', async () => {
    const runCli = async (args: string[]) => {
      if (args[0] === 'provider') throw new Error('ur provider status --json: not ready')
      if (args[0] === 'ide') return { stdout: JSON.stringify({ workspaceRoot: '/w' }), stderr: '' }
      return { stdout: '1.36.1', stderr: '' }
    }
    const status = await assembleAgentStatus('/w', runCli)
    expect(status.provider.providerKind).toBe('unknown')
    expect(status.provider.multimodal).toBe('unknown')
    expect(status.warnings.some(w => w.includes('provider status'))).toBe(true)
  })

  test('every CLI call failing still returns a renderable status, not a throw', async () => {
    const runCli = async (): Promise<never> => {
      throw new Error('ur not on PATH')
    }
    await expect(assembleAgentStatus('/w', runCli)).resolves.toBeDefined()
    const status = await assembleAgentStatus('/w', runCli)
    expect(status.urVersion).toBe('unknown')
    expect(status.workspaceRoot).toBe('/w')
    expect(status.warnings.length).toBeGreaterThan(0)
  })
})
