import * as React from 'react'
import { Box, Text } from '../../ink.js'

type ComputerInput = {
  action?: string
  x?: number
  y?: number
  button?: string
  text?: string
}

type ComputerResult = {
  action?: string
  ok?: boolean
  detail?: string
  screenshotPath?: string
}

/** One-line summary of what the model asked the desktop to do. */
export function describeInput(input: ComputerInput | undefined): string {
  if (!input?.action) return 'desktop'
  switch (input.action) {
    case 'screenshot':
      return 'screenshot'
    case 'click':
      return `${input.button === 'right' ? 'right-click' : 'click'} ${input.x},${input.y}`
    case 'type':
      // Never echo the text: it may be a password the user is dictating.
      return `type ${input.text?.length ?? 0} chars`
    default:
      return input.action
  }
}

export function renderToolUseMessage(
  input: ComputerInput | undefined,
): React.ReactNode {
  return <Text>{describeInput(input)}</Text>
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <Box>
      <Text dimColor>Controlling desktop…</Text>
    </Box>
  )
}

export function renderToolResultMessage(
  result: ComputerResult | undefined,
): React.ReactNode {
  if (!result) return null
  return (
    <Box>
      <Text color={result.ok ? 'success' : 'error'}>
        {result.ok ? '✓' : '✗'} {result.detail ?? ''}
      </Text>
    </Box>
  )
}
