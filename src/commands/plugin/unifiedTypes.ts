/**
 * A row in the unified "installed items" list that ManagePlugins renders —
 * plugins, MCP servers, their detail rows and error states share one list, so
 * one shape covers all of them and `type` says which row this is.
 *
 * Reconstructed from use. It was an empty interface, which to TypeScript means
 * "has no members" rather than "shape unknown", so every field access was an
 * error — ~56 of the ones behind @ts-nocheck in the plugin UI.
 *
 * `type` is left as a string rather than a union of the sixteen values
 * ManagePlugins compares against: the list is rendered from several sources and
 * a value missing from the union would turn a working comparison into a
 * no-overlap error, which is a worse failure than a loose field.
 */
export interface UnifiedInstalledItem {
  /** Which kind of row this is: 'plugin', 'mcp', 'mcp-detail', 'pending', ... */
  type: string
  id?: string
  name?: string
  /** Rendered label, used for rows that are pure presentation. */
  text?: string
  /** Detail rows are shown nested under their parent. */
  indented?: boolean
  scope?: string
  marketplace?: string
  plugin?: unknown
  client?: unknown
  errors?: unknown[]
  reason?: string
  flaggedAt?: string | number
}
