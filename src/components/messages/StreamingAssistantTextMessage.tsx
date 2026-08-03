import React, { useRef } from 'react'
import { BLACK_CIRCLE } from '../../constants/figures.js'
import { Box, Text } from '../../ink.js'
import { StreamingDeliberationProjector } from '../../utils/deliberationText.js'
import { StreamingMarkdown } from '../Markdown.js'

type Props = {
  text: string
  showFull: boolean
}

/**
 * Renders a stable live answer preview without ever painting undecided model
 * self-talk. This changes presentation only: `text` remains untouched for the
 * transcript, persisted messages, and future model context.
 */
export function StreamingAssistantTextMessage({
  text,
  showFull,
}: Props): React.ReactNode {
  // The projector intentionally advances monotonically during render, just as
  // StreamingMarkdown's stable-prefix parser does. It is idempotent under a
  // StrictMode double render and resets when this per-turn component unmounts.
  'use no memo'

  const projectorRef = useRef<StreamingDeliberationProjector | null>(null)
  if (!projectorRef.current) {
    projectorRef.current = new StreamingDeliberationProjector()
  }
  const visibleText = showFull
    ? text
    : projectorRef.current.project(text)

  if (!visibleText) return null

  return (
    <Box
      alignItems="flex-start"
      flexDirection="row"
      marginTop={1}
      width="100%"
    >
      <Box flexDirection="row">
        <Box minWidth={2}>
          <Text color="text">{BLACK_CIRCLE}</Text>
        </Box>
        <Box flexDirection="column">
          <StreamingMarkdown>{visibleText}</StreamingMarkdown>
        </Box>
      </Box>
    </Box>
  )
}
