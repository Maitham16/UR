/**
 * Keybinding shapes. The originals are not part of this distribution, so these
 * are reconstructed from how parser.ts and resolver.ts use them.
 *
 * They were empty interfaces, which to TypeScript means "has no members" rather
 * than "shape unknown" — so every `keystroke.ctrl`, `binding.chord` and
 * `binding.action` was an error. That accounts for ~89 of the errors behind
 * @ts-nocheck in this directory.
 */

/** A single key press with its modifier state, as produced by parseChord. */
export interface ParsedKeystroke {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
  super?: boolean
}

/**
 * A sequence of keystrokes. resolver.ts reads `binding.chord.length` and
 * parser.ts passes it to `chordToString`, so this is an ordered list rather
 * than a single stroke.
 */
export type Chord = ParsedKeystroke[]

/**
 * The command a binding invokes, e.g. 'app:exit' or 'chat:cancel'. Kept as a
 * string rather than a union: defaultBindings.ts builds these conditionally
 * from feature flags, and a value missing from a union would turn a working
 * entry into an error.
 */
export type KeybindingAction = string

/** Where a binding applies (editor, dialog, global, ...). */
export type KeybindingContextName = string

/** A binding after parsing: the chord string resolved into keystrokes. */
export interface ParsedBinding {
  chord: Chord
  action: KeybindingAction
  context?: KeybindingContextName
}

/**
 * A group of bindings sharing a context, as declared in defaultBindings.ts.
 *
 * `bindings` is keyed by chord string ('ctrl+d', 'ctrl+x ctrl+k', 'escape'),
 * not a list — an earlier reconstruction typed it as ParsedBinding[] and every
 * entry in the default table became "property does not exist on ParsedBinding[]".
 * The declaration form and the parsed form are different shapes.
 */
export interface KeybindingBlock {
  context?: KeybindingContextName
  bindings: Record<string, KeybindingAction>
}
