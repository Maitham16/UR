import * as React from 'react'
import { useState } from 'react'
import { Box, Text } from 'src/ink.js'
import { formatAPIError } from 'src/services/api/errorUtils.js'
import type { SystemAPIErrorMessage as SystemAPIErrorMessageType } from 'src/types/message.js'
import { useInterval } from 'usehooks-ts'
import { CtrlOToExpand } from '../CtrlOToExpand.js'
import { MessageResponse } from '../MessageResponse.js'

const MAX_API_ERROR_CHARS = 1000
const MAX_COMPACT_ERROR_CHARS = 120
const DETAILED_RETRY_ATTEMPT = 4

type Props = {
  message: SystemAPIErrorMessageType
  verbose: boolean
}

export function formatApiRetryStatus(
  retryAttempt: number,
  maxRetries: number,
  retryInMs: number,
  countdownMs: number,
): string {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((retryInMs - countdownMs) / 1000),
  )
  const attempt =
    maxRetries > 0 && retryAttempt <= maxRetries
      ? `${retryAttempt}/${maxRetries}`
      : String(retryAttempt)
  return remainingSeconds > 0
    ? `API retry ${attempt} in ${remainingSeconds}s`
    : `API retry ${attempt} starting`
}

export function compactApiError(
  error: Parameters<typeof formatAPIError>[0],
): string {
  const firstLine = formatAPIError(error)
    .split('\n')
    .find(line => line.trim().length > 0)
    ?.trim()
  const summary = firstLine || 'Temporary API request failure'
  return summary.length > MAX_COMPACT_ERROR_CHARS
    ? `${summary.slice(0, MAX_COMPACT_ERROR_CHARS - 1)}…`
    : summary
}

export function SystemAPIErrorMessage({
  message,
  verbose,
}: Props): React.ReactNode {
  const { retryAttempt, error, retryInMs, maxRetries } = message
  const [countdownMs, setCountdownMs] = useState(0)
  const done = countdownMs >= retryInMs
  const showDetails = verbose || retryAttempt >= DETAILED_RETRY_ATTEMPT
  const retryStatus = formatApiRetryStatus(
    retryAttempt,
    maxRetries,
    retryInMs,
    countdownMs,
  )

  useInterval(
    () => setCountdownMs(ms => ms + 1000),
    done ? null : 1000,
  )

  if (!showDetails) {
    return (
      <MessageResponse>
        <Box height={1} overflow="hidden">
          <Text color="warning">{retryStatus}</Text>
          <Text dimColor wrap="truncate-end">
            {' · '}
            {compactApiError(error)}
          </Text>
        </Box>
      </MessageResponse>
    )
  }

  const formatted = formatAPIError(error)
  const truncated = !verbose && formatted.length > MAX_API_ERROR_CHARS
  const displayedError = truncated
    ? `${formatted.slice(0, MAX_API_ERROR_CHARS)}…`
    : formatted

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">{displayedError}</Text>
        {truncated && <CtrlOToExpand />}
        <Text dimColor>
          {retryStatus}
          {process.env.API_TIMEOUT_MS
            ? ` · API_TIMEOUT_MS=${process.env.API_TIMEOUT_MS}ms; try increasing it`
            : ''}
        </Text>
      </Box>
    </MessageResponse>
  )
}
