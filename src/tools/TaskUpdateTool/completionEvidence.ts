import type { Message } from '../../types/message.js'

const FILE_MUTATION_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
])

const COMPLETION_EVIDENCE_TOOLS = new Set([
  // Direct inspection
  'Read',
  'Grep',
  'Glob',
  'LSP',
  // Executed checks and interactive/runtime verification
  'Bash',
  'PowerShell',
  'TestRunner',
  'Browser',
  'Computer',
  'TaskOutput',
  // A delegated reviewer/verifier may provide the observable check.
  'Agent',
  'Task',
])

type CompletedToolCall = {
  name: string
  input: Record<string, unknown>
  succeeded: boolean
  sequence: number
  assistantMessage: number
}

export type CompletionEvidenceDecision =
  | { defer: false }
  | {
      defer: true
      mutationTool: string
      target?: string
    }

function messageBlocks(message: Message): unknown[] {
  const content = message.message?.content
  return Array.isArray(content) ? content : []
}

function successfulCalls(messages: unknown): CompletedToolCall[] {
  if (!Array.isArray(messages)) return []

  const toolUses = new Map<
    string,
    {
      name: string
      input: Record<string, unknown>
      sequence: number
      assistantMessage: number
    }
  >()
  const calls: CompletedToolCall[] = []
  let sequence = 0

  for (const [messageIndex, candidate] of messages.entries()) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const message = candidate as Message
    for (const block of messageBlocks(message)) {
      sequence++
      if (typeof block !== 'object' || block === null) continue
      const value = block as Record<string, unknown>
      if (
        value.type === 'tool_use' &&
        typeof value.id === 'string' &&
        typeof value.name === 'string'
      ) {
        toolUses.set(value.id, {
          name: value.name,
          input:
            typeof value.input === 'object' && value.input !== null
              ? (value.input as Record<string, unknown>)
              : {},
          sequence,
          assistantMessage: messageIndex,
        })
        continue
      }
      if (
        value.type !== 'tool_result' ||
        typeof value.tool_use_id !== 'string'
      ) {
        continue
      }
      const toolUse = toolUses.get(value.tool_use_id)
      if (!toolUse) continue
      calls.push({
        ...toolUse,
        succeeded: value.is_error !== true,
      })
    }
  }
  return calls.sort((left, right) => left.sequence - right.sequence)
}

function sameTaskId(value: unknown, taskId: string): boolean {
  return (
    (typeof value === 'string' || typeof value === 'number') &&
    String(value) === taskId
  )
}

function mutationTarget(call: CompletedToolCall): string | undefined {
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = call.input[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/**
 * Prevent the last task from being closed immediately after a file mutation
 * with no observable check. This is deliberately evidence-based rather than
 * inferred from task prose: if history is missing/compacted, or no mutation is
 * visible after the task became in_progress, completion proceeds unchanged.
 */
export function evaluateCompletionEvidence(input: {
  messages: unknown
  taskId: string
}): CompletionEvidenceDecision {
  const calls = successfulCalls(input.messages)
  let startedAt = -1
  for (const call of calls) {
    if (
      call.succeeded &&
      call.name === 'TaskUpdate' &&
      sameTaskId(call.input.taskId, input.taskId) &&
      call.input.status === 'in_progress'
    ) {
      startedAt = call.sequence
    }
  }
  if (startedAt < 0) return { defer: false }

  let latestMutation: CompletedToolCall | undefined
  let hasEvidenceAfterMutation = false
  for (const call of calls) {
    if (!call.succeeded || call.sequence <= startedAt) continue
    if (FILE_MUTATION_TOOLS.has(call.name)) {
      latestMutation = call
      hasEvidenceAfterMutation = false
      continue
    }
    if (
      latestMutation &&
      call.assistantMessage > latestMutation.assistantMessage &&
      COMPLETION_EVIDENCE_TOOLS.has(call.name)
    ) {
      hasEvidenceAfterMutation = true
    }
  }

  if (!latestMutation || hasEvidenceAfterMutation) {
    return { defer: false }
  }
  return {
    defer: true,
    mutationTool: latestMutation.name,
    target: mutationTarget(latestMutation),
  }
}
