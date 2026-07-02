import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOriginalCwd, setOriginalCwd } from '../src/bootstrap/state.js'
import { SandboxManager } from '../src/utils/sandbox/sandbox-adapter.js'
import { SandboxManager as BaseSandboxManager } from '../src/utils/sandbox/sandboxRuntimeCompat.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'
import { updateSettingsForSource } from '../src/utils/settings/settings.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

// Direct regression coverage for the sandbox-adapter.ts SandboxManager (formerly
// @ts-nocheck). Each test points localSettings at an isolated temp directory so
// nothing here reads or writes the real repo's .ur/settings.local.json.
describe('sandbox-adapter (direct regression coverage)', () => {
  let dir: string
  let savedOriginalCwd: string

  beforeEach(() => {
    dir = tempDir('ur-sandbox-adapter-')
    savedOriginalCwd = getOriginalCwd()
    setOriginalCwd(dir)
    resetSettingsCache()
  })

  afterEach(async () => {
    await SandboxManager.reset()
    setOriginalCwd(savedOriginalCwd)
    resetSettingsCache()
    rmSync(dir, { recursive: true, force: true })
  })

  function setSandboxSettings(sandbox: Record<string, unknown>): void {
    const { error } = updateSettingsForSource('localSettings', { sandbox } as never)
    if (error) throw error
    resetSettingsCache()
  }

  test('disabled mode: sandbox is not required, no unavailable reason, sandboxing off', () => {
    setSandboxSettings({ enabled: false })
    expect(SandboxManager.isSandboxRequired()).toBe(false)
    expect(SandboxManager.getSandboxUnavailableReason()).toBeUndefined()
    expect(SandboxManager.isSandboxingEnabled()).toBe(false)
  })

  test('recommended mode (enabled, failIfUnavailable=false) does not fail closed when unavailable', () => {
    // enabledPlatforms: [] deterministically forces "unavailable" regardless of
    // whether this machine actually has bwrap/sandbox-exec installed.
    setSandboxSettings({ enabled: true, failIfUnavailable: false, enabledPlatforms: [] })
    expect(SandboxManager.getSandboxUnavailableReason()).toBeDefined() // still surfaced...
    expect(SandboxManager.isSandboxRequired()).toBe(false) // ...but not required, so callers must not refuse to start
  })

  test('required mode (enabled, failIfUnavailable=true) fails closed when unavailable', () => {
    setSandboxSettings({ enabled: true, failIfUnavailable: true, enabledPlatforms: [] })
    expect(SandboxManager.isSandboxRequired()).toBe(true)
    expect(SandboxManager.getSandboxUnavailableReason()).toBeDefined()
  })

  test('getSandboxUnavailableReason returns a useful, human-readable reason when required+unavailable', () => {
    setSandboxSettings({ enabled: true, failIfUnavailable: true, enabledPlatforms: [] })
    const reason = SandboxManager.getSandboxUnavailableReason()
    expect(typeof reason).toBe('string')
    expect(reason!.length).toBeGreaterThan(0)
    expect(reason).toContain('sandbox.enabledPlatforms')
  })

  test('required mode proceeds (no unavailable reason) when the sandbox is actually available', async () => {
    const platformSpy = spyOn(BaseSandboxManager, 'isSupportedPlatform').mockReturnValue(true)
    const depsSpy = spyOn(BaseSandboxManager, 'checkDependencies').mockReturnValue({ errors: [], warnings: [] })
    try {
      await SandboxManager.reset() // drop memoized isSupportedPlatform/checkDependencies before re-reading
      setSandboxSettings({ enabled: true, failIfUnavailable: true })
      expect(SandboxManager.getSandboxUnavailableReason()).toBeUndefined()
      expect(SandboxManager.isSandboxingEnabled()).toBe(true)
      expect(SandboxManager.isSandboxRequired()).toBe(true)
    } finally {
      platformSpy.mockRestore()
      depsSpy.mockRestore()
    }
  })

  test('mirrors the startup refusal composition used by print.ts and REPL.tsx', () => {
    // Both call sites gate startup on exactly this composition:
    //   const reason = SandboxManager.getSandboxUnavailableReason()
    //   if (reason) { if (SandboxManager.isSandboxRequired()) refuse; else warn }
    setSandboxSettings({ enabled: true, failIfUnavailable: true, enabledPlatforms: [] })
    const requiredReason = SandboxManager.getSandboxUnavailableReason()
    const refusesWhenRequired = Boolean(requiredReason) && SandboxManager.isSandboxRequired()
    expect(refusesWhenRequired).toBe(true)

    setSandboxSettings({ enabled: true, failIfUnavailable: false, enabledPlatforms: [] })
    const recommendedReason = SandboxManager.getSandboxUnavailableReason()
    const refusesWhenRecommended = Boolean(recommendedReason) && SandboxManager.isSandboxRequired()
    expect(recommendedReason).toBeDefined() // still warns...
    expect(refusesWhenRecommended).toBe(false) // ...but never refuses to start
  })

  test('wrapWithSandbox forwards network/filesystem customConfig to the base runtime unchanged', async () => {
    setSandboxSettings({ enabled: false }) // skip the initializationPromise gate entirely
    const customConfig = {
      network: { blockAll: true, allowedDomains: ['example.com'], deniedDomains: ['evil.invalid'] },
      filesystem: { allowWrite: ['/tmp/allowed'], denyWrite: ['/tmp/denied'] },
    }
    const wrapSpy = spyOn(BaseSandboxManager, 'wrapWithSandbox')
    try {
      await SandboxManager.wrapWithSandbox('echo hi', '/bin/bash', customConfig)
      expect(wrapSpy).toHaveBeenCalledTimes(1)
      const [command, binShell, forwardedConfig] = wrapSpy.mock.calls[0]!
      expect(command).toBe('echo hi')
      expect(binShell).toBe('/bin/bash')
      expect(forwardedConfig).toEqual(customConfig)
    } finally {
      wrapSpy.mockRestore()
    }
  })

  test('wrapWithSandbox throws a clear error when sandboxing is enabled but never initialized', async () => {
    const platformSpy = spyOn(BaseSandboxManager, 'isSupportedPlatform').mockReturnValue(true)
    const depsSpy = spyOn(BaseSandboxManager, 'checkDependencies').mockReturnValue({ errors: [], warnings: [] })
    try {
      await SandboxManager.reset()
      setSandboxSettings({ enabled: true })
      expect(SandboxManager.isSandboxingEnabled()).toBe(true)
      // initialize() was never called, so initializationPromise is still undefined.
      await expect(SandboxManager.wrapWithSandbox('echo hi')).rejects.toThrow(
        'Sandbox failed to initialize',
      )
    } finally {
      platformSpy.mockRestore()
      depsSpy.mockRestore()
    }
  })
})
