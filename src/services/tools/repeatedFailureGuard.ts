/**
 * Stops a model repeating a tool call that keeps failing.
 *
 * A 4B model refused once by the task-list gate answered by emitting `Write`
 * with no arguments — no file_path, no content — over and over, plus
 * `Computer(type 0 chars)`. Nothing stopped it. The trajectory grader already
 * names this `repeated-identical-failure`, but only after the run is over, so
 * it can grade the wreck and never prevent it.
 *
 * The rule is narrow on purpose: identical tool *and* identical input. A model
 * retrying with corrected arguments is doing exactly what a refusal asked of
 * it, and must never be penalised for that.
 */
export type RepeatedFailureConfig = {
  /** Identical failures tolerated before the call is refused outright. */
  limit: number
  /** Attempts after the limit before the turn is aborted entirely. */
  abortAfter: number
}

export const REPEATED_FAILURE_DEFAULTS: RepeatedFailureConfig = {
  // Two genuine retries are plausible — a transient error, then a fix that
  // happens to fail the same way. A third identical failure is a loop.
  limit: 3,
  abortAfter: 6,
}

const failureCounts = new Map<string, number>()

export function resetRepeatedFailuresForTesting(): void {
  failureCounts.clear()
}

/**
 * Stable across key order, so `{a:1,b:2}` and `{b:2,a:1}` count as the same
 * call. Falls back to a marker rather than throwing on unserialisable input:
 * this runs on every tool call and must never be the thing that breaks one.
 */
export function callSignature(
  toolName: string,
  input: unknown,
): string {
  let serialized: string
  try {
    serialized = JSON.stringify(input, Object.keys(input as object ?? {}).sort())
  } catch {
    serialized = '<unserializable>'
  }
  return `${toolName}:${serialized}`
}

export function recordCallFailure(signature: string): number {
  const next = (failureCounts.get(signature) ?? 0) + 1
  failureCounts.set(signature, next)
  return next
}

/** A call that worked clears its own history, so a later failure starts fresh. */
export function recordCallSuccess(signature: string): void {
  failureCounts.delete(signature)
}

export type RepeatDecision =
  | { action: 'allow' }
  | { action: 'refuse'; reason: string }
  | { action: 'abort'; reason: string }

export function checkRepeatedFailure(
  signature: string,
  config: RepeatedFailureConfig = REPEATED_FAILURE_DEFAULTS,
): RepeatDecision {
  const failures = failureCounts.get(signature) ?? 0
  if (failures >= config.abortAfter) {
    return {
      action: 'abort',
      reason:
        `This exact call has failed ${failures} times and is still being ` +
        `repeated. Stopping the turn rather than continuing to loop.`,
    }
  }
  if (failures >= config.limit) {
    return {
      action: 'refuse',
      reason:
        `This exact call has already failed ${failures} times with the same ` +
        `arguments, so it will fail again. Do not retry it unchanged. Either ` +
        `fix the arguments, use a different tool, or tell the user what is ` +
        `blocking you and stop.`,
    }
  }
  return { action: 'allow' }
}
