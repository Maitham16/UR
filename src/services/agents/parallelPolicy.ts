const READ_ONLY_START =
  /^\s*(?:analy[sz]e|audit|compare|explain|explore|find|inspect|investigate|list|plan|read|research|review|search|summari[sz]e|trace)\b/i
const READ_ONLY_SIGNAL =
  /\b(?:analy[sz]e|audit|compare|explain|explore|inspect|investigate|read|research|review|search|trace)\b/i
const MUTATION_SIGNAL =
  /\b(?:add|apply|build|bump|change|commit|correct|create|delete|deploy|edit|fix|format|generate|implement|install|integrate|modify|move|optimi[sz]e|patch|publish|refactor|remove|rename|repair|resolve|ship|update|write)\b/i
const EXPLICIT_READ_ONLY =
  /\b(?:read[- ]only|do not|don't|must not|without)\s+(?:edit|modify|mutate|write|change|implement|patch|create|delete|remove)\b/i

/** Conservative shared-workspace access classification. Unknown work writes. */
export function isClearlyReadOnlyWork(description: string): boolean {
  const text = description.trim()
  if (!text) return false
  if (EXPLICIT_READ_ONLY.test(text) && READ_ONLY_SIGNAL.test(text)) return true
  return READ_ONLY_START.test(text) && !MUTATION_SIGNAL.test(text)
}

export function isDelegationConcurrencySafe(input: {
  prompt: string
  isolation?: 'worktree' | 'remote'
}): boolean {
  return (
    input.isolation === 'worktree' ||
    input.isolation === 'remote' ||
    isClearlyReadOnlyWork(input.prompt)
  )
}
