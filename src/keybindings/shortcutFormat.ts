import { loadKeybindingsSync } from './loadUserBindings.js'
import { resolveBindingDisplay } from './resolver.js'
import type { KeybindingContextName, ParsedBinding } from './types.js'

export const UNBOUND_SHORTCUT_DISPLAY = ''

export class MissingKeybindingError extends Error {
  constructor(action: string, context: KeybindingContextName) {
    super(
      `No keybinding is registered for action "${action}" in context "${String(context)}"`,
    )
    this.name = 'MissingKeybindingError'
  }
}

/**
 * Get the display text for a configured shortcut without React hooks.
 * Use this in non-React contexts (commands, services, etc.).
 *
 * This lives in its own module (not useShortcutDisplay.ts) so that
 * non-React callers like query/stopHooks.ts don't pull React into their
 * module graph via the sibling hook.
 *
 * @param action - The action name (e.g., 'app:toggleTranscript')
 * @param context - The keybinding context (e.g., 'Global')
 * @returns The configured shortcut display text
 *
 * @example
 * const expandShortcut = getShortcutDisplay('app:toggleTranscript', 'Global')
 */
export function getShortcutDisplay(
  action: string,
  context: KeybindingContextName,
): string {
  return getShortcutDisplayFromBindings(
    action,
    context,
    loadKeybindingsSync(),
  )
}

/** Resolve against an explicit registry snapshot (used by the React provider). */
export function getShortcutDisplayFromBindings(
  action: string,
  context: KeybindingContextName,
  bindings: readonly ParsedBinding[],
): string {
  const resolved = resolveBindingDisplay(action, context, bindings)
  if (resolved.type === 'bound') return resolved.display
  if (resolved.type === 'unbound') return UNBOUND_SHORTCUT_DISPLAY
  throw new MissingKeybindingError(action, context)
}
