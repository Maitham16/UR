import type {
  KEYBINDING_ACTIONS,
  KEYBINDING_CONTEXTS,
} from './schema.js'

/** A UI scope in which a keybinding can be active. */
export type KeybindingContextName = (typeof KEYBINDING_CONTEXTS)[number]

export type BuiltInKeybindingAction = (typeof KEYBINDING_ACTIONS)[number]

/** Built-in action or a slash-command binding from keybindings.json. */
export type KeybindingAction =
  | BuiltInKeybindingAction
  | `command:${string}`

/** One context block in the persisted keybindings.json contract. */
export type KeybindingBlock = {
  context: KeybindingContextName
  bindings: Record<string, KeybindingAction | null>
}

/** Parsed, normalized terminal keystroke. */
export type ParsedKeystroke = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  super: boolean
}

/** A single keystroke or a multi-keystroke sequence. */
export type Chord = ParsedKeystroke[]

/** Flat runtime representation used by the resolver. */
export type ParsedBinding = {
  chord: Chord
  action: KeybindingAction | null
  context: KeybindingContextName
}
