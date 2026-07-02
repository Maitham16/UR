import { describe, expect, test } from 'bun:test'
import {
  buildDefaultStatusBar,
  statusBarShouldDisplay,
} from '../src/utils/statusBar.js'
import { getEffectiveStatusLineSettings } from '../src/components/StatusLine.js'
import { getProviderRuntimeInfo } from '../src/services/providers/providerRegistry.js'

describe('UR-AGENT status bar', () => {
  test('formats compact runtime state', () => {
    const text = buildDefaultStatusBar({
      version: '1.25.3',
      providerLabel: 'Codex CLI',
      authMode: 'subscription',
      model: 'modelH',
      mode: 'acceptEdits',
      branch: 'main',
      taskRunningCount: 1,
      taskTotalCount: 3,
      checksStatus: 'tests passed',
    })

    expect(text).toContain('Codex CLI')
    expect(text).toContain('modelH')
    expect(text).toContain('acceptEdits')
    expect(text).toContain('main')
    expect(text).toContain('tasks: 1/3 running')
    expect(text).toContain('tests passed')
    expect(text).not.toContain('UR-AGENT')
    expect(text).not.toContain('v1.25.3')
    expect(text).not.toContain('Auth:')
  })

  test('shows update availability when known', () => {
    const text = buildDefaultStatusBar({
      version: '1.23.3',
      latestVersion: '1.25.0',
    })

    expect(text).toBe('update 1.25.0 available')
  })

  test('hides by default in CI, dumb terminals, and non-tty output', () => {
    expect(statusBarShouldDisplay({ isCI: true })).toBe(false)
    expect(statusBarShouldDisplay({ term: 'dumb' })).toBe(false)
    expect(statusBarShouldDisplay({ isTTY: false })).toBe(false)
  })

  test('allows custom status-line hooks even when stdout is not a tty', () => {
    expect(
      statusBarShouldDisplay({
        settingsStatusLineConfigured: true,
        isTTY: false,
      }),
    ).toBe(true)
  })

  test('uses in-session provider/model over stale persisted settings', () => {
    const effective = getEffectiveStatusLineSettings(
      {
        provider: {
          active: 'codex-cli',
          model: 'codex/gpt-5.5',
        },
      },
      {
        active: 'gemini-cli',
        model: 'gemini-cli/gemini-2.5-pro',
      },
    )
    const runtime = getProviderRuntimeInfo(effective)
    const text = buildDefaultStatusBar({
      version: '1.28.0',
      providerLabel: runtime.providerLabel,
      authMode: runtime.authLabel,
      model: runtime.model,
    })

    expect(runtime.provider).toBe('gemini-cli')
    expect(runtime.model).toBe('gemini-cli/gemini-2.5-pro')
    expect(text).toContain('Gemini CLI')
    expect(text).toContain('gemini-cli/gemini-2.5-pro')
    expect(text).not.toContain('Codex CLI')
    expect(text).not.toContain('codex/gpt-5.5')
  })
})
