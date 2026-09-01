import { useOptionalKeybindingContext } from './KeybindingContext.js'
import {
  getShortcutDisplay,
  getShortcutDisplayFromBindings,
} from './shortcutFormat.js'
import type { KeybindingContextName } from './types.js'

/**
 * Hook to get the display text for a configured shortcut.
 * Returns the configured binding. Missing action/context registrations are a
 * programming error rather than a silently divergent hardcoded shortcut.
 *
 * @param action - The action name (e.g., 'app:toggleTranscript')
 * @param context - The keybinding context (e.g., 'Global')
 * @returns The configured shortcut display text
 *
 * @example
 * const expandShortcut = useShortcutDisplay('app:toggleTranscript', 'Global')
 */
export function useShortcutDisplay(
  action: string,
  context: KeybindingContextName,
  options: { enabled?: boolean } = {},
): string {
  const keybindingContext = useOptionalKeybindingContext()
  if (options.enabled === false) return ''
  if (!keybindingContext) return getShortcutDisplay(action, context)
  return getShortcutDisplayFromBindings(
    action,
    context,
    keybindingContext.bindings,
  )
}
