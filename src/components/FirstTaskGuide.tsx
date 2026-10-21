import * as React from 'react'
import { Box, Text } from '../ink.js'

/** Guidance inside the existing setup screen; it does not change execution settings. */
export function FirstTaskGuide(): React.ReactNode {
  return <Box flexDirection="column" gap={1}>
    <Text bold>Start your first task</Text>
    <Text>Open /model to choose a provider and model. For an API provider, press K to add or replace its key. Local servers and official subscription CLIs use their own setup.</Text>
    <Text>Run /ur-doctor for connection diagnostics, changed files, current verification evidence, costs and recovery commands. Diagnostics do not run a model.</Text>
    <Text>Try: “Explain how this project runs its tests. Do not modify files.”</Text>
    <Text dimColor>Ctrl+C interrupts foreground work. Use /cost to inspect reported usage, and ur --resume to return to a saved session. Review the diff and test evidence before accepting a change.</Text>
  </Box>
}
