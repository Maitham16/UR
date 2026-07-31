import { describe, expect, test } from 'bun:test'
import {
  buildDefaultStatusBar,
  statusBarShouldDisplay,
} from '../src/utils/statusBar.js'
import {
  buildStatusLineRefreshKey,
  buildStatusLineRuntimeFields,
  getActiveToolName,
  getEffectiveStatusLineSettings,
  shouldUseCustomStatusLine,
  summarizeStatusTasks,
} from '../src/components/StatusLine.js'
import { stringWidth } from '../src/ink/stringWidth.js'
import { getProviderRuntimeInfo } from '../src/services/providers/providerRegistry.js'

describe('UR-Nexus status bar', () => {
  test('formats compact runtime state', () => {
    const text = buildDefaultStatusBar({
      version: '1.25.3',
      providerLabel: 'Codex CLI',
      authMode: 'subscription',
      model: 'modelH',
      mode: 'acceptEdits',
      branch: 'main',
      taskRunningCount: 1,
      taskCompletedCount: 2,
      taskTotalCount: 3,
      checksStatus: 'tests passed',
    })

    expect(text).toContain('Codex CLI')
    expect(text).toContain('modelH')
    expect(text).toContain('acceptEdits')
    expect(text).toContain('main')
    // Progress is reported as completed-of-total; the running count is added
    // only when it says something the ratio does not.
    expect(text).toContain('2/3 done')
    expect(text).toContain('1 running')
    expect(text).toContain('tests passed')
    expect(text).not.toContain('UR-Nexus')
    expect(text).not.toContain('v1.25.3')
    expect(text).not.toContain('Auth:')
    expect(text.indexOf('modelH')).toBeLessThan(
      text.indexOf('2/3 done'),
    )
    expect(text.indexOf('2/3 done')).toBeLessThan(
      text.indexOf('Codex CLI'),
    )
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

  test('remains visible in agent mode', () => {
    expect(statusBarShouldDisplay({ isKairosActive: true, isTTY: true })).toBe(
      true,
    )
  })

  test('fits CJK and emoji labels by terminal display width', () => {
    const text = buildDefaultStatusBar({
      version: '1.0.0',
      state: 'working',
      model: '模型-🚀-very-long-model-name',
      activeTask: '調査中の長いタスク名',
      columns: 18,
    })

    expect(stringWidth(text)).toBeLessThanOrEqual(18)
  })

  test('uses an explicit built-in field selection over stale custom output', () => {
    expect(
      shouldUseCustomStatusLine(
        {
          statusLine: { type: 'command', command: 'custom-status' },
          statusBarFields: { model: true },
        },
        true,
        'stale custom text',
      ),
    ).toBe(false)
    expect(
      shouldUseCustomStatusLine(
        { statusLine: { type: 'command', command: 'custom-status' } },
        true,
        'fresh custom text',
      ),
    ).toBe(true)
    expect(
      shouldUseCustomStatusLine(
        { statusLine: { type: 'command', command: 'custom-status' } },
        false,
        'stale custom text',
      ),
    ).toBe(false)
  })

  test('reports only unresolved tool activity', () => {
    const messages = [
      {
        type: 'assistant',
        uuid: 'assistant-1',
        message: {
          content: [
            { type: 'tool_use', id: 'done', name: 'Read', input: {} },
            { type: 'tool_use', id: 'active', name: 'Bash', input: {} },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'user-1',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'done', content: '' }],
        },
      },
    ] as never

    expect(getActiveToolName(messages)).toBe('Bash')
  })

  test('summarizes the TaskV2 list rather than background processes', () => {
    expect(
      summarizeStatusTasks([
        { status: 'completed', subject: 'Inspect' },
        {
          status: 'in_progress',
          subject: 'Implement',
          activeForm: 'Implementing fixes',
        },
        { status: 'pending', subject: 'Verify' },
        { status: 'failed', subject: 'Package' },
      ]),
    ).toEqual({
      running: 1,
      pending: 1,
      completed: 1,
      failed: 1,
      blocked: 0,
      total: 4,
      activeTask: 'Implementing fixes',
    })
  })

  test('marks dependency-waiting tasks as blocked until prerequisites complete', () => {
    expect(
      summarizeStatusTasks([
        { id: '1', status: 'in_progress', subject: 'Build' },
        {
          id: '2',
          status: 'pending',
          subject: 'Package',
          blockedBy: ['1'],
        },
      ]).blocked,
    ).toBe(1)
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

  test('custom status-line input and invalidation follow the live model', () => {
    const runtime = getProviderRuntimeInfo({
      provider: {
        active: 'gemini-cli',
        model: 'persisted/model',
      },
    })
    const firstModel = 'gemini-cli/gemini-2.5-pro'
    const nextModel = 'gemini-cli/gemini-3-pro'
    const fields = buildStatusLineRuntimeFields(firstModel, runtime)

    expect(fields.model.id).toBe(firstModel)
    expect(fields.provider.model).toBe(firstModel)
    expect(fields.provider.model).not.toBe('persisted/model')
    expect(buildStatusLineRefreshKey(runtime, firstModel)).not.toBe(
      buildStatusLineRefreshKey(runtime, nextModel),
    )
  })

  test('status-line invalidation keys cannot collide across delimited runtime fields', () => {
    const runtime = getProviderRuntimeInfo({
      provider: {
        active: 'gemini-cli',
        model: 'persisted/model',
      },
    })
    const firstRuntime = {
      ...runtime,
      model: 'persisted/model',
    }
    const secondRuntime = {
      ...runtime,
      model: 'model|persisted/model',
    }

    expect(buildStatusLineRefreshKey(firstRuntime, 'segment|model')).not.toBe(
      buildStatusLineRefreshKey(secondRuntime, 'segment'),
    )
    expect(JSON.parse(buildStatusLineRefreshKey(runtime, 'live/model'))[1]).toBe(
      'live/model',
    )
  })
})
