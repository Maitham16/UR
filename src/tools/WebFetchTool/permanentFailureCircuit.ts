import { getSessionId } from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import { isHumanTurn } from '../../utils/messagePredicates.js'
import {
  callSignature,
  checkRepeatedFailure,
  recordCallFailure,
  recordCallSuccess,
  RepeatedToolFailureAbort,
  type RepeatDecision,
} from '../../services/tools/repeatedFailureGuard.js'
import { PermanentWebFetchHttpError } from './utils.js'

/**
 * Permanent client errors cannot be repaired by changing WebFetch's hidden
 * summarization prompt. Refuse the first repeated URL and stop the turn if the
 * model ignores that refusal. This intentionally does not apply to timeouts,
 * rate limits, or 5xx responses.
 */
export const WEB_FETCH_PERMANENT_FAILURE_POLICY = {
  enabled: true,
  limit: 1,
  abortAfter: 2,
} as const

function normalizedFailureUrl(url: string): string {
  try {
    const parsed = new URL(url)
    // WebFetch upgrades HTTP before sending it, and fragments never reach the
    // server. Treat these spelling differences as one network request.
    if (parsed.protocol === 'http:') parsed.protocol = 'https:'
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

export function webFetchPermanentFailureScope(
  context: Pick<ToolUseContext, 'queryTracking' | 'agentId' | 'messages'>,
): string {
  if (context.queryTracking?.chainId) {
    // Matches toolExecution/query cleanup, so a completed turn cannot poison a
    // later user request for the same URL.
    return `query:${context.queryTracking.chainId}`
  }
  const latestHumanTurn = context.messages.findLast(isHumanTurn)?.uuid
  return (
    `session:${getSessionId()}:agent:${context.agentId ?? 'main'}:` +
    `turn:${latestHumanTurn ?? 'untracked'}`
  )
}

export function webFetchPermanentFailureSignature(
  scope: string,
  url: string,
): string {
  // The URL is hashed by callSignature and never retained in guard state.
  // Deliberately omit `prompt`: it cannot change an HTTP response status.
  return callSignature(
    'WebFetchPermanentURL',
    { url: normalizedFailureUrl(url) },
    scope,
  )
}

function circuitMessage(decision: Exclude<RepeatDecision, { action: 'allow' }>): string {
  const recovery =
    'Do not fetch this URL again in this turn, even with a different prompt. ' +
    'Use WebSearch, fetch a parent/index page, or choose another source.'
  if (decision.action === 'abort') {
    return `Repeated permanent WebFetch failure. ${recovery} Stopping the turn instead of continuing the loop.`
  }
  return `WebFetch circuit breaker: this URL already returned a permanent HTTP client error. ${recovery}`
}

/** Execute one fetch behind the permanent-URL circuit breaker. */
export async function withWebFetchPermanentFailureCircuit<T>(
  url: string,
  scope: string,
  operation: () => Promise<T>,
): Promise<T> {
  const signature = webFetchPermanentFailureSignature(scope, url)
  const decision = checkRepeatedFailure(
    signature,
    WEB_FETCH_PERMANENT_FAILURE_POLICY,
  )
  if (decision.action === 'abort') {
    throw new RepeatedToolFailureAbort(circuitMessage(decision))
  }
  if (decision.action === 'refuse') {
    // A refused unchanged attempt is itself evidence that the model is stuck.
    recordCallFailure(signature)
    throw new Error(circuitMessage(decision))
  }

  try {
    const result = await operation()
    recordCallSuccess(signature)
    return result
  } catch (error) {
    if (error instanceof PermanentWebFetchHttpError) {
      recordCallFailure(signature)
    }
    throw error
  }
}
