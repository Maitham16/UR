export const PROVIDER_API_KEY_LABEL = 'API key: '

/**
 * TextInput requires an explicit width. Account for the label and the Pane's
 * two-cell padding on each side so a masked secret remains on one terminal
 * row instead of falling back to the cursor engine's two-column safety width.
 */
export function getProviderApiKeyInputColumns(
  terminalColumns: number,
  isStandaloneCommand: boolean,
): number {
  const width = Number.isFinite(terminalColumns)
    ? Math.floor(terminalColumns)
    : 0
  const panePadding = isStandaloneCommand ? 4 : 0
  return Math.max(2, width - panePadding - PROVIDER_API_KEY_LABEL.length)
}
