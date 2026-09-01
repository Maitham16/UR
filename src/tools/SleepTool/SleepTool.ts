import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  isProactiveActive,
  setNextTickAt,
} from '../../proactive/index.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { hasCommandsInQueue } from '../../utils/messageQueueManager.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import {
  DESCRIPTION,
  SLEEP_TOOL_NAME,
  SLEEP_TOOL_PROMPT,
} from './prompt.js'

export const SLEEP_QUEUE_POLL_MS = 1_000

const activeSleepDeadlines = new Map<symbol, number | null>()

function publishNextSleepDeadline(): void {
  const deadlines = [...activeSleepDeadlines.values()].filter(
    (deadline): deadline is number => deadline !== null,
  )
  setNextTickAt(deadlines.length > 0 ? Math.min(...deadlines) : null)
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    duration: z
      .number()
      .nonnegative()
      .finite()
      .describe('How long to wait, in seconds.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    reason: z.enum(['elapsed', 'message', 'interrupted']),
    sleptMs: z.number().nonnegative(),
    effectiveDurationMs: z.number().nonnegative().nullable(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type SleepOutput = z.infer<OutputSchema>

type SleepSettings = {
  minSleepDurationMs?: number
  maxSleepDurationMs?: number
}

/** Resolve settings once at tool-call start so a running sleep is stable. */
export function resolveSleepDurationMs(
  requestedSeconds: number,
  settings: SleepSettings,
): number {
  if (settings.maxSleepDurationMs === -1) return Number.POSITIVE_INFINITY
  const requestedMs = Math.max(0, requestedSeconds * 1_000)
  const minimum = Math.max(0, settings.minSleepDurationMs ?? 0)
  const maximum = Math.max(0, settings.maxSleepDurationMs ?? Infinity)
  return Math.min(Math.max(requestedMs, minimum), maximum)
}

type WaitForSleepOptions = {
  durationMs: number
  signal: AbortSignal
  pollMs?: number
  hasPendingCommand?: () => boolean
  onProgress?: (elapsedMs: number, remainingMs: number | null) => void
}

function waitForTimer(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export async function waitForSleep({
  durationMs,
  signal,
  pollMs = SLEEP_QUEUE_POLL_MS,
  hasPendingCommand = hasCommandsInQueue,
  onProgress,
}: WaitForSleepOptions): Promise<SleepOutput> {
  const startedAt = Date.now()
  const finite = Number.isFinite(durationMs)
  while (true) {
    const elapsedMs = Math.max(0, Date.now() - startedAt)
    if (signal.aborted) {
      return {
        reason: 'interrupted',
        sleptMs: elapsedMs,
        effectiveDurationMs: finite ? durationMs : null,
      }
    }
    if (hasPendingCommand()) {
      return {
        reason: 'message',
        sleptMs: elapsedMs,
        effectiveDurationMs: finite ? durationMs : null,
      }
    }
    if (finite && elapsedMs >= durationMs) {
      return {
        reason: 'elapsed',
        sleptMs: elapsedMs,
        effectiveDurationMs: durationMs,
      }
    }

    const remainingMs = finite ? Math.max(0, durationMs - elapsedMs) : null
    onProgress?.(elapsedMs, remainingMs)
    await waitForTimer(
      Math.max(1, Math.min(pollMs, remainingMs ?? pollMs)),
      signal,
    )
  }
}

export const SleepTool = buildTool({
  name: SLEEP_TOOL_NAME,
  searchHint: 'wait without holding a shell process',
  maxResultSizeChars: 10_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isProactiveActive()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  interruptBehavior() {
    return 'cancel'
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return SLEEP_TOOL_PROMPT
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const content =
      output.reason === 'elapsed'
        ? `Finished waiting after ${Math.round(output.sleptMs)}ms.`
        : output.reason === 'message'
          ? 'Stopped waiting because a message is ready.'
          : 'Sleep was interrupted.'
    return { type: 'tool_result', tool_use_id: toolUseID, content }
  },
  async call({ duration }, context, _canUseTool, _parentMessage, onProgress) {
    const settings = getInitialSettings() as SleepSettings
    const durationMs = resolveSleepDurationMs(duration, settings)
    const deadline = Number.isFinite(durationMs) ? Date.now() + durationMs : null
    const sleepToken = Symbol('sleep')
    activeSleepDeadlines.set(sleepToken, deadline)
    publishNextSleepDeadline()
    try {
      return {
        data: await waitForSleep({
          durationMs,
          signal: context.abortController.signal,
          onProgress(elapsedMs, remainingMs) {
            onProgress?.({
              toolUseID: context.toolUseId ?? '',
              data: {
                type: 'sleep_progress',
                elapsedMs,
                remainingMs,
              },
            })
          },
        }),
      }
    } finally {
      activeSleepDeadlines.delete(sleepToken)
      publishNextSleepDeadline()
    }
  },
} satisfies ToolDef<InputSchema, SleepOutput>)
