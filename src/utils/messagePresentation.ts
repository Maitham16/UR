type PresentationMessage = {
  type: string
  uuid?: string
  isApiErrorMessage?: boolean
  message?: {
    id?: string
    content?: Array<{ type?: string }>
  }
}

function sourceMessageKey(message: PresentationMessage): string | null {
  const id = message.message?.id
  if (id) return `id:${id}`
  if (message.uuid) return `uuid:${message.uuid.slice(0, 24)}`
  return null
}

function isToolExecutionBlock(block: { type?: string } | undefined): boolean {
  return block?.type === 'tool_use' || block?.type?.endsWith('_tool_use') === true
}

/**
 * Removes assistant prose that belongs to the same provider message as a tool
 * call. That prose is a work prelude, not the turn's final answer. This helper
 * is presentation-only: callers retain the untouched transcript for storage,
 * context, exports, and the explicit transcript screen.
 */
export function dropIntermediateToolNarration<T extends PresentationMessage>(
  messages: readonly T[],
): T[] {
  const sourcesWithToolExecution = new Set<string>()

  for (const message of messages) {
    if (message.type !== 'assistant') continue
    if (!message.message?.content?.some(isToolExecutionBlock)) continue
    const key = sourceMessageKey(message)
    if (key) sourcesWithToolExecution.add(key)
  }

  if (sourcesWithToolExecution.size === 0) return [...messages]

  return messages.filter(message => {
    if (message.type !== 'assistant' || message.isApiErrorMessage) return true
    // The display pipeline passes normalized one-block messages. Fail open if
    // a future caller supplies an unsplit response so its tool block can never
    // be removed together with the prelude.
    if (
      message.message?.content?.length !== 1 ||
      message.message.content[0]?.type !== 'text'
    ) {
      return true
    }
    const key = sourceMessageKey(message)
    return key === null || !sourcesWithToolExecution.has(key)
  })
}

/** Live drafts stay private in the normal UI and remain opt-in diagnostics. */
export function shouldShowLiveAssistantDraft(
  isTranscriptMode: boolean,
  verbose: boolean,
): boolean {
  return isTranscriptMode || verbose
}
