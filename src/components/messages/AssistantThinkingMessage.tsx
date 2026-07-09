import type {
  ThinkingBlock,
  ThinkingBlockParam,
} from '@urhq-ai/sdk/resources/index.mjs'
import React from 'react'
import { Box, Text } from '../../ink.js'
import { CtrlOToExpand } from '../CtrlOToExpand.js'
import { Markdown } from '../Markdown.js'

type Props = {
  // Accept either full ThinkingBlock/ThinkingBlockParam or a minimal shape with just type and thinking
  param:
    | ThinkingBlock
    | ThinkingBlockParam
    | { type: 'thinking'; thinking: string }
  addMargin: boolean
  isTranscriptMode: boolean
  verbose: boolean
  /** When true, hide this thinking block entirely (used for past thinking in transcript mode) */
  hideInTranscript?: boolean
}

/**
 * Renders a thinking block. Deliberately styled as the model's internal
 * monologue — dim, italic, labeled, and (when expanded) fenced behind a
 * left border — so it cannot be confused with the answer text addressed
 * to the user (which renders bright with an accent-colored ⏺ marker in
 * AssistantTextMessage).
 */
export function AssistantThinkingMessage({
  param: { thinking },
  addMargin = false,
  isTranscriptMode,
  verbose,
  hideInTranscript = false,
}: Props): React.ReactNode {
  if (!thinking) {
    return null
  }

  if (hideInTranscript) {
    return null
  }

  const shouldShowFullThinking = isTranscriptMode || verbose
  const label = '∴ Thinking'
  const sublabel = 'model reasoning to itself — not the answer'

  if (!shouldShowFullThinking) {
    return (
      <Box marginTop={addMargin ? 1 : 0}>
        <Text dimColor italic>
          {label} · {sublabel} <CtrlOToExpand />
        </Text>
      </Box>
    )
  }

  return (
    <Box
      flexDirection="column"
      marginTop={addMargin ? 1 : 0}
      width="100%"
    >
      <Text dimColor italic>
        {label} · {sublabel}
      </Text>
      <Box
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderDimColor={true}
        paddingLeft={1}
        marginLeft={1}
      >
        <Markdown dimColor>{thinking}</Markdown>
      </Box>
    </Box>
  )
}
