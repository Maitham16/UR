export type InsertModeRemapState = {
  buffer: string
  matched: boolean
  removeFromExisting?: number
  insertBeforeEscape?: string
}

export function isValidVimEscapeSequence(value: string): boolean {
  return value.length >= 2 && value.length <= 8 && !/[\s\p{C}]/u.test(value)
}

/**
 * Tracks only the longest suffix that could still become the configured
 * escape sequence. Characters are not delayed; the caller removes the
 * completed sequence from the input when matched.
 */
export function advanceInsertModeEscapeSequence(
  buffer: string,
  input: string,
  sequence: string,
): InsertModeRemapState {
  if (!isValidVimEscapeSequence(sequence) || input.length === 0) {
    return { buffer: '', matched: false }
  }
  const candidate = buffer + input
  if (candidate.endsWith(sequence)) {
    const sequenceCharsFromInput = Math.min(sequence.length, input.length)
    return {
      buffer: '',
      matched: true,
      removeFromExisting: sequence.length - sequenceCharsFromInput,
      insertBeforeEscape: input.slice(0, input.length - sequenceCharsFromInput),
    }
  }
  for (let length = Math.min(sequence.length - 1, candidate.length); length > 0; length--) {
    const suffix = candidate.slice(-length)
    if (sequence.startsWith(suffix)) return { buffer: suffix, matched: false }
  }
  return { buffer: '', matched: false }
}
