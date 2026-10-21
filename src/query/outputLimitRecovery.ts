import { createHash } from 'node:crypto'

type RecoveryMessage = {
  isApiErrorMessage?: boolean
  message?: { content?: unknown }
}

export type OutputLimitRecoveryDecision = {
  shouldContinue: boolean
  continuationCount: number
  consecutiveStalls: number
  hasVisibleContent: boolean
  hasReasoningContent: boolean
  consecutiveInvisibleResponses: number
  stallReason?: 'empty' | 'repeated'
}

/**
 * A total-output ceiling makes long agent tasks fail merely because they are
 * long. UR instead continues while every provider-capped response makes novel
 * progress and stops only after repeated evidence that the model is stuck.
 */
export class OutputLimitRecoveryTracker {
  private readonly seen = new Set<string>()
  private continuationCount = 0
  private consecutiveStalls = 0
  private consecutiveInvisibleResponses = 0

  record(messages: RecoveryMessage[]): OutputLimitRecoveryDecision {
    const { fingerprint, hasVisibleContent, hasReasoningContent } =
      progressFingerprint(messages)
    const stallReason = !fingerprint
      ? 'empty'
      : this.seen.has(fingerprint)
        ? 'repeated'
        : undefined

    this.continuationCount++
    this.consecutiveInvisibleResponses = hasVisibleContent
      ? 0
      : this.consecutiveInvisibleResponses + 1
    if (stallReason) {
      this.consecutiveStalls++
    } else {
      this.consecutiveStalls = 0
      this.seen.add(fingerprint!)
    }

    return {
      shouldContinue: this.consecutiveStalls < 2,
      continuationCount: this.continuationCount,
      consecutiveStalls: this.consecutiveStalls,
      hasVisibleContent,
      hasReasoningContent,
      consecutiveInvisibleResponses: this.consecutiveInvisibleResponses,
      ...(stallReason ? { stallReason } : {}),
    }
  }

  reset(): void {
    this.seen.clear()
    this.continuationCount = 0
    this.consecutiveStalls = 0
    this.consecutiveInvisibleResponses = 0
  }
}

function progressFingerprint(messages: RecoveryMessage[]): {
  fingerprint?: string
  hasVisibleContent: boolean
  hasReasoningContent: boolean
} {
  const textParts: string[] = []
  const thinkingParts: string[] = []
  const opaqueParts: string[] = []

  for (const message of messages) {
    if (message.isApiErrorMessage) continue
    const content = message.message?.content
    const blocks = Array.isArray(content) ? content : [content]
    for (const block of blocks) {
      if (typeof block === 'string') {
        textParts.push(block)
        continue
      }
      if (!block || typeof block !== 'object') continue
      const value = block as Record<string, unknown>
      if (value.type === 'text' && typeof value.text === 'string') {
        textParts.push(value.text)
      } else if (
        value.type === 'thinking' &&
        typeof value.thinking === 'string'
      ) {
        thinkingParts.push(value.thinking)
      } else if (
        value.type === 'redacted_thinking' &&
        typeof value.data === 'string'
      ) {
        opaqueParts.push(value.data)
      }
    }
  }

  // Stream block/message boundaries and changing provider metadata are not
  // progress. Preserve the actual content, including code indentation and
  // newlines; only canonicalize line endings after joining split blocks.
  const text = textParts.join('').replace(/\r\n/gu, '\n')
  const thinking = thinkingParts.join('').replace(/\r\n/gu, '\n')
  const opaque = opaqueParts.join('')
  const hasVisibleContent = text.trim().length > 0
  const hasThinkingContent = thinking.trim().length > 0
  const hasReasoningContent = hasThinkingContent || opaque.length > 0
  if (!hasVisibleContent && !hasReasoningContent) {
    return { hasVisibleContent, hasReasoningContent }
  }

  // Once there is visible output, fresh hidden reasoning cannot make an
  // identical answer count as progress. Reasoning-only retries are separately
  // reported through consecutiveInvisibleResponses for budget recovery.
  const progress = hasVisibleContent
    ? { text }
    : {
        thinking: hasThinkingContent ? thinking : undefined,
        // Compare actual opaque bytes without inspecting or retaining data.
        // Equal-sized encrypted payloads are not evidence of exact replay.
        opaqueDigest: opaque.length > 0
          ? createHash('sha256').update(opaque).digest('hex')
          : undefined,
      }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(progress))
    .digest('hex')
  return { fingerprint, hasVisibleContent, hasReasoningContent }
}
