import {
  findEvidenceFor,
  formatEvidence,
  formatEvidenceCheck,
  listEvidence,
} from '../../security/evidenceLedger.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'

export const call: LocalCommandCall = async args => {
  const tokens = parseArguments(args ?? '')
  const json = tokens.includes('--json')

  const checkIndex = tokens.indexOf('--check')
  if (checkIndex >= 0) {
    // Everything after --check is the span: a claim is a sentence, not a word,
    // so taking only the next token would silently truncate it.
    const span = tokens
      .slice(checkIndex + 1)
      .filter(token => token !== '--json')
      .join(' ')
    const matches = findEvidenceFor(span)
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ span, matches }, null, 2)
        : formatEvidenceCheck(span, matches),
    }
  }

  const entries = tokens.includes('--flagged')
    ? listEvidence().filter(entry => entry.suspicious)
    : listEvidence()
  return { type: 'text', value: formatEvidence(entries, json) }
}
