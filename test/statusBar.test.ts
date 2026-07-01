import { describe, expect, test } from 'bun:test'
import {
  buildDefaultStatusBar,
  statusBarShouldDisplay,
} from '../src/utils/statusBar.js'

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

    expect(text).toContain('UR-AGENT v1.25.3')
    expect(text).toContain('Provider: Codex CLI')
    expect(text).toContain('Auth: subscription')
    expect(text).toContain('model: modelH')
    expect(text).toContain('mode: acceptEdits')
    expect(text).toContain('branch: main')
    expect(text).toContain('tasks: 1/3 running')
    expect(text).toContain('checks: tests passed')
  })

  test('shows update availability when known', () => {
    const text = buildDefaultStatusBar({
      version: '1.23.3',
      latestVersion: '1.25.0',
    })

    expect(text).toContain('Update: 1.23.3 -> 1.25.0 available')
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
})
