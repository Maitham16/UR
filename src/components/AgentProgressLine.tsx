import * as React from 'react'
import { Box, Text } from '../ink.js'
import { formatNumber } from '../utils/format.js'
import type { Theme } from '../utils/theme.js'

type Props = {
  agentType: string
  description?: string
  name?: string
  descriptionColor?: keyof Theme
  taskDescription?: string
  toolUseCount: number
  tokens: number | null
  color?: keyof Theme
  isLast: boolean
  isResolved: boolean
  isError: boolean
  isAsync?: boolean
  lastToolInfo?: string | null
  hideType?: boolean
}

export function getAgentProgressStatus({
  isResolved,
  isError,
  isBackgrounded,
  lastToolInfo,
  taskDescription,
}: {
  isResolved: boolean
  isError: boolean
  isBackgrounded: boolean
  lastToolInfo?: string | null
  taskDescription?: string
}): string {
  if (isError) return 'Failed'
  if (!isResolved) return lastToolInfo || 'Initializing…'
  if (isBackgrounded) {
    return taskDescription ?? 'Running in the background'
  }
  return 'Done'
}

export function AgentProgressLine({
  agentType,
  description,
  name,
  descriptionColor,
  taskDescription,
  toolUseCount,
  tokens,
  color,
  isLast,
  isResolved,
  isError,
  isAsync = false,
  lastToolInfo,
  hideType = false,
}: Props): React.ReactNode {
  const treeChar = isLast ? '└─' : '├─'
  const isBackgrounded = isAsync && isResolved && !isError
  const statusText = getAgentProgressStatus({
    isResolved,
    isError,
    isBackgrounded,
    lastToolInfo,
    taskDescription,
  })

  const identity = hideType ? (
    <>
      <Text bold>{name ?? description ?? agentType}</Text>
      {name && description && <Text dimColor>: {description}</Text>}
    </>
  ) : (
    <>
      <Text
        bold
        backgroundColor={color}
        color={color ? 'inverseText' : undefined}
      >
        {agentType}
      </Text>
      {description && (
        <>
          {' ('}
          <Text
            backgroundColor={descriptionColor}
            color={descriptionColor ? 'inverseText' : undefined}
          >
            {description}
          </Text>
          {')'}
        </>
      )}
    </>
  )

  return (
    <Box flexDirection="column" overflow="hidden">
      <Box paddingLeft={3} overflow="hidden" height={1}>
        <Text dimColor>{treeChar} </Text>
        <Text dimColor={!isResolved} wrap="truncate-end">
          {identity}
          {!isBackgrounded && (
            <>
              {' · '}
              {toolUseCount} tool {toolUseCount === 1 ? 'use' : 'uses'}
              {tokens !== null && <> · {formatNumber(tokens)} tokens</>}
            </>
          )}
        </Text>
      </Box>
      {!isBackgrounded && (
        <Box
          paddingLeft={3}
          flexDirection="row"
          overflow="hidden"
          height={1}
        >
          <Text dimColor>{isLast ? '   ⎿  ' : '│  ⎿  '}</Text>
          <Text
            color={isError ? 'error' : undefined}
            dimColor={!isError}
            wrap="truncate-end"
          >
            {statusText}
          </Text>
        </Box>
      )}
    </Box>
  )
}
