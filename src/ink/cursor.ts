/**
 * Terminal cursor position. Reconstructed from use: an empty interface means
 * "has no members" to TypeScript, so every `cursor.x` / `cursor.y` /
 * `cursor.visible` read was an error.
 */
export interface Cursor {
  x: number
  y: number
  visible: boolean
}
