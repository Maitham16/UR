import { createHash } from 'node:crypto'

type RecoveryMessage = {
  isApiErrorMessage?: boolean
  message?: { content?: unknown }
}

export type OutputLimitRecoveryDecision = {
  shouldContinue: boolean
  continuationCount: number
  consecutiveStalls: number
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

  record(messages: RecoveryMessage[]): OutputLimitRecoveryDecision {
    const fingerprint = progressFingerprint(messages)
    const stallReason = !fingerprint
      ? 'empty'
      : this.seen.has(fingerprint)
        ? 'repeated'
        : undefined

    this.continuationCount++
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
      ...(stallReason ? { stallReason } : {}),
    }
  }

  reset(): void {
    this.seen.clear()
    this.continuationCount = 0
    this.consecutiveStalls = 0
  }
}

function progressFingerprint(messages: RecoveryMessage[]): string | undefined {
  const material = messages
    .filter(message => !message.isApiErrorMessage)
    .flatMap(message => {
      const content = message.message?.content
      return Array.isArray(content) ? content : content === undefined ? [] : [content]
    })
    .map(projectProgressValue)
    .filter(value => value !== undefined && value !== '')

  if (material.length === 0) return undefined
  return createHash('sha256')
    .update(JSON.stringify(material))
    .digest('hex')
}

function projectProgressValue(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\s+/gu, ' ').trim()
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }
  if (Array.isArray(value)) return value.map(projectProgressValue)
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : undefined
  if (type === 'redacted_thinking' && typeof record.data === 'string') {
    // Opaque reasoning is deliberately not inspected. Its size is stable
    // enough to detect exact replay without retaining provider-encrypted data.
    return { type, opaqueBytes: record.data.length }
  }

  const projected: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    if (/^(?:id|request_id|signature|uuid)$/u.test(key)) continue
    const nested = projectProgressValue(record[key])
    if (nested !== undefined && nested !== '') projected[key] = nested
  }
  return projected
}
