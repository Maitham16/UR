import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import type { ToolUseContext } from '../src/Tool.js'
import { getAllBaseTools } from '../src/tools.js'
import {
  clearSessionsWithTungstenUsage,
  executeTungstenAction,
  TungstenTool,
  type TungstenTmuxRunner,
} from '../src/tools/TungstenTool/TungstenTool.js'
import { isTungstenEnabled } from '../src/tools/TungstenTool/availability.js'

const originalUserType = process.env.USER_TYPE

afterEach(() => {
  clearSessionsWithTungstenUsage()
  if (originalUserType === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = originalUserType
})

function contextHarness() {
  let state: Record<string, unknown> = {}
  const context = {
    getAppState: () => state,
    setAppState: (update: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      state = update(state)
    },
  } as unknown as ToolUseContext
  return { context, getState: () => state }
}

describe('Tungsten tool contract', () => {
  test('is a complete Tool and registers in ant mode without null dereferences', () => {
    process.env.USER_TYPE = 'ant'
    const registered = getAllBaseTools().find(tool => tool.name === 'Tungsten')

    expect(registered).toBe(TungstenTool)
    expect(registered?.isEnabled()).toBe(true)
    expect(registered?.outputSchema).toBeDefined()
    expect(typeof registered?.renderPermissionRequest).toBe('function')
    expect(
      registered?.renderPermissionRequest({} as Parameters<
        typeof TungstenTool.renderPermissionRequest
      >[0]),
    ).not.toBeNull()
    const selectorSource = readFileSync(
      'src/components/agents/ToolSelector.tsx',
      'utf8',
    )
    expect(selectorSource).toContain('TungstenTool.name')
  })

  test('uses one runtime gate for registration, monitor, and footer surfaces', () => {
    process.env.USER_TYPE = 'external'
    expect(isTungstenEnabled()).toBe(false)
    process.env.USER_TYPE = 'ant'
    expect(isTungstenEnabled()).toBe(true)

    for (const file of [
      'src/screens/REPL.tsx',
      'src/components/PromptInput/PromptInput.tsx',
      'src/components/PromptInput/PromptInputFooterLeftSide.tsx',
    ]) {
      const source = readFileSync(file, 'utf8')
      expect(source).toContain('isTungstenEnabled()')
      const tungstenLines = source
        .split('\n')
        .filter(line => /tungsten|tmux/i.test(line))
        .join('\n')
      expect(tungstenLines).not.toContain('"external"')
      expect(tungstenLines).not.toContain("'external'")
    }
  })

  test('creates a session and publishes live-panel state', async () => {
    const calls: readonly string[][] = []
    const runTmux: TungstenTmuxRunner = async args => {
      ;(calls as string[][]).push([...args])
      return { code: 0, stdout: '', stderr: '' }
    }
    const harness = contextHarness()

    const result = await executeTungstenAction(
      { action: 'create_session', session_name: 'verify-1' },
      harness.context,
      runTmux,
    )

    expect(result).toMatchObject({
      success: true,
      session_name: 'verify-1',
      target: 'verify-1:0.0',
    })
    expect(calls[0]?.slice(0, 5)).toEqual([
      'new-session',
      '-d',
      '-s',
      'verify-1',
      '-c',
    ])
    expect(harness.getState().tungstenActiveSession).toMatchObject({
      sessionName: 'verify-1',
      target: 'verify-1:0.0',
    })

    const listed = await executeTungstenAction(
      { action: 'list_sessions' },
      harness.context,
      async () => ({
        code: 0,
        stdout: 'verify-1\t1\t0\nother\t2\t1\n',
        stderr: '',
      }),
    )
    expect(listed.sessions).toEqual([
      { name: 'verify-1', windows: 1, attached: false, managed: true },
      { name: 'other', windows: 2, attached: true, managed: false },
    ])
  })

  test('sends literal text and Enter as separate tmux operations', async () => {
    const calls: string[][] = []
    const runTmux: TungstenTmuxRunner = async args => {
      calls.push([...args])
      if (args[0] === 'display-message') {
        return { code: 0, stdout: 'verify\t%3\n', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    const harness = contextHarness()

    const result = await executeTungstenAction(
      {
        action: 'send_keys',
        target: 'verify:0.0',
        text: 'echo Enter && printf done',
      },
      harness.context,
      runTmux,
    )

    expect(result.success).toBe(true)
    expect(calls).toEqual([
      [
        'display-message',
        '-p',
        '-t',
        'verify:0.0',
        '#{session_name}\t#{pane_id}',
      ],
      [
        'send-keys',
        '-t',
        '%3',
        '-l',
        'echo Enter && printf done',
      ],
      ['send-keys', '-t', '%3', 'Enter'],
    ])
    expect(result).toMatchObject({ session_name: 'verify', target: '%3' })
  })

  test('keeps the active session identity when targeting a pane ID', async () => {
    const runTmux: TungstenTmuxRunner = async args =>
      args[0] === 'display-message'
        ? { code: 0, stdout: 'verify\t%7\n', stderr: '' }
        : { code: 0, stdout: 'ready\n', stderr: '' }
    const harness = contextHarness()
    harness.context.setAppState(prev => ({
      ...prev,
      tungstenActiveSession: {
        sessionName: 'verify',
        socketName: 'ur-test',
        target: '%7',
      },
    }))

    const result = await executeTungstenAction(
      { action: 'capture_pane', target: '%7' },
      harness.context,
      runTmux,
    )

    expect(result.session_name).toBe('verify')
    expect(harness.getState().tungstenActiveSession).toMatchObject({
      sessionName: 'verify',
      target: '%7',
    })
  })

  test('validates session names and exactly one send payload', async () => {
    const runTmux: TungstenTmuxRunner = async () => {
      throw new Error('runner must not be called for invalid input')
    }
    const harness = contextHarness()

    const badSession = await executeTungstenAction(
      { action: 'create_session', session_name: '../user-session' },
      harness.context,
      runTmux,
    )
    const ambiguousSend = await executeTungstenAction(
      {
        action: 'send_keys',
        target: 'verify:0.0',
        text: 'pwd',
        keys: ['Enter'],
      },
      harness.context,
      runTmux,
    )

    expect(badSession.success).toBe(false)
    expect(ambiguousSend.message).toContain('exactly one')
  })

  test('rejects a target whose canonical tmux session disagrees with session_name', async () => {
    const calls: string[][] = []
    const harness = contextHarness()
    const result = await executeTungstenAction(
      {
        action: 'send_keys',
        session_name: 'alpha',
        target: 'beta:0.0',
        text: 'pwd',
      },
      harness.context,
      async args => {
        calls.push([...args])
        return { code: 0, stdout: 'beta\t%9\n', stderr: '' }
      },
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('belongs to tmux session "beta"')
    expect(calls).toHaveLength(1)
    expect(harness.getState().tungstenActiveSession).toBeUndefined()
  })

  test('permission messages expose an escaped, bounded send_keys payload', async () => {
    const input = {
      action: 'send_keys' as const,
      target: 'verify:0.0',
      text: 'printf "hello"\nrm -f ./artifact',
    }
    const message = String(TungstenTool.renderToolUseMessage(input))
    const decision = await TungstenTool.checkPermissions(input, {} as never)

    expect(message).toContain('text="printf \\"hello\\"\\nrm -f ./artifact"')
    expect(message).not.toContain('hello"\nrm')
    expect(decision).toMatchObject({ behavior: 'ask' })
    expect(decision.behavior === 'ask' ? decision.message : '').toContain(
      'rm -f ./artifact',
    )

    const longMessage = String(
      TungstenTool.renderToolUseMessage({ ...input, text: 'x'.repeat(1_000) }),
    )
    expect(longMessage).toContain('600 more characters')
    expect(longMessage.length).toBeLessThan(520)
  })
})
