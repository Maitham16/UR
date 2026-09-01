import { feature } from 'bun:bundle'
import { describe, expect, test } from 'bun:test'
import type { Key } from '../src/ink.js'
import {
  getShortcutDisplay,
  getShortcutDisplayFromBindings,
  MissingKeybindingError,
} from '../src/keybindings/shortcutFormat.js'
import { DEFAULT_BINDINGS } from '../src/keybindings/defaultBindings.js'
import {
  KEYBINDING_ACTIONS,
  KEYBINDING_CONTEXTS,
} from '../src/keybindings/schema.js'
import { parseChord } from '../src/keybindings/parser.js'
import { resolveKeyWithChordState } from '../src/keybindings/resolver.js'
import type { ParsedBinding } from '../src/keybindings/types.js'

describe('keybinding display migration', () => {
  test('resolves UI hints from the registry without hardcoded fallbacks', () => {
    const registrations = [
      ['app:toggleTranscript', 'Global'],
      ['app:toggleTodos', 'Global'],
      ['history:search', 'Global'],
      ['chat:cancel', 'Chat'],
      ['chat:cycleMode', 'Chat'],
      ['chat:externalEditor', 'Chat'],
      ['chat:fastMode', 'Chat'],
      ['chat:imagePaste', 'Chat'],
      ['chat:killAgents', 'Chat'],
      ['chat:modelPicker', 'Chat'],
      ['chat:stash', 'Chat'],
      ['chat:thinkingToggle', 'Chat'],
      ['chat:undo', 'Chat'],
      ['confirm:no', 'Confirmation'],
      ['confirm:yes', 'Confirmation'],
      ['confirm:cycleMode', 'Confirmation'],
      ['confirm:no', 'Settings'],
      ['select:accept', 'Settings'],
      ['settings:close', 'Settings'],
      ['settings:retry', 'Settings'],
      ['settings:search', 'Settings'],
      ['select:accept', 'Select'],
      ['select:cancel', 'Select'],
      ['select:previous', 'Select'],
      ['plugin:install', 'Plugin'],
      ['plugin:toggle', 'Plugin'],
      ['task:background', 'Task'],
      ['theme:toggleSyntaxHighlighting', 'ThemePicker'],
      ['transcript:toggleShowAll', 'Transcript'],
      ['diff:dismiss', 'DiffDialog'],
      ['help:dismiss', 'Help'],
      ['attachments:next', 'Attachments'],
      ['attachments:previous', 'Attachments'],
      ['attachments:remove', 'Attachments'],
      ['attachments:exit', 'Attachments'],
    ] as const

    for (const [action, context] of registrations) {
      expect(getShortcutDisplay(action, context)).not.toBe('')
    }
  })

  test('feature-gated terminal binding exists only in terminal-panel builds', () => {
    const registered = DEFAULT_BINDINGS.some(block =>
      Object.values(block.bindings).includes('app:toggleTerminal'),
    )
    if (feature('TERMINAL_PANEL')) expect(registered).toBe(true)
    else expect(registered).toBe(false)
  })

  test('unknown actions fail with a precise migration diagnostic', () => {
    expect(() =>
      getShortcutDisplay('missing:action', 'Global'),
    ).toThrow(MissingKeybindingError)
  })

  test('a later null on the same context and chord hides the stale label', () => {
    const bindings: ParsedBinding[] = [
      {
        context: 'Global',
        chord: parseChord('ctrl+o'),
        action: 'app:toggleTranscript',
      },
      {
        context: 'Global',
        chord: parseChord('ctrl+o'),
        action: null,
      },
    ]

    expect(
      getShortcutDisplayFromBindings(
        'app:toggleTranscript',
        'Global',
        bindings,
      ),
    ).toBe('')
  })

  test('a later rebind becomes the displayed shortcut', () => {
    const bindings: ParsedBinding[] = [
      {
        context: 'Global',
        chord: parseChord('ctrl+o'),
        action: 'app:toggleTranscript',
      },
      {
        context: 'Global',
        chord: parseChord('ctrl+o'),
        action: null,
      },
      {
        context: 'Global',
        chord: parseChord('alt+o'),
        action: 'app:toggleTranscript',
      },
    ]

    expect(
      getShortcutDisplayFromBindings(
        'app:toggleTranscript',
        'Global',
        bindings,
      ),
    ).toBe('alt+o')
  })

  test('alt/meta aliases share last-wins display identity', () => {
    const bindings: ParsedBinding[] = [
      {
        context: 'Global',
        chord: parseChord('meta+j'),
        action: 'app:toggleTerminal',
      },
      {
        context: 'Global',
        chord: parseChord('alt+j'),
        action: null,
      },
    ]

    expect(
      getShortcutDisplayFromBindings('app:toggleTerminal', 'Global', bindings),
    ).toBe('')
  })

  test('alt/meta null overrides also shadow longer-chord prefixes', () => {
    const bindings: ParsedBinding[] = [
      {
        context: 'Chat',
        chord: parseChord('meta+x meta+k'),
        action: 'chat:killAgents',
      },
      {
        context: 'Chat',
        chord: parseChord('alt+x alt+k'),
        action: null,
      },
    ]
    const key = {
      ctrl: false,
      shift: false,
      meta: true,
      super: false,
      escape: false,
    } as Key

    expect(
      resolveKeyWithChordState('x', key, ['Chat'], bindings, null),
    ).toEqual({ type: 'none' })
  })

  test('runtime defaults cannot drift beyond the typed schema contract', () => {
    const contexts = new Set<string>(KEYBINDING_CONTEXTS)
    const actions = new Set<string>(KEYBINDING_ACTIONS)

    expect(contexts.has('Scroll')).toBe(true)
    expect(contexts.has('MessageActions')).toBe(true)
    for (const block of DEFAULT_BINDINGS) {
      expect(contexts.has(block.context), block.context).toBe(true)
      for (const action of Object.values(block.bindings)) {
        if (action === null || action.startsWith('command:')) continue
        expect(actions.has(action), action).toBe(true)
      }
    }
  })
})
