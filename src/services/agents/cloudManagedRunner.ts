import { randomUUID } from 'node:crypto'
import type { SDKMessage, SDKResultMessage } from '../../entrypoints/agentSdkTypes.js'
import type { PermissionMode } from '../../types/permissions.js'

export type ManagedCloudStartInput = {
  taskId: string
  candidateId: string
  prompt: string
  model?: string
  environmentId?: string
  permissionMode?: PermissionMode
  signal: AbortSignal
}

export type ManagedCloudStartResult = {
  sessionId: string
  title: string
}

export type ManagedCloudInspection = {
  status: 'running' | 'completed' | 'failed' | 'canceled'
  cursor?: string | null
  branch?: string
  output?: string
  verdict?: string | null
  events?: unknown[]
  error?: string
}

/**
 * Narrow, injectable CCR surface used by the cloud task store. Keeping this
 * interface free of TUI state makes managed tasks deterministic in tests and
 * lets a detached worker recover solely from the persisted session ids.
 */
export type ManagedCloudClient = {
  start(input: ManagedCloudStartInput): Promise<ManagedCloudStartResult>
  inspect(sessionId: string, cursor?: string | null): Promise<ManagedCloudInspection>
  steer(sessionId: string, message: string, requestId: string): Promise<boolean>
  cancel(sessionId: string): Promise<void>
}

function resultOutput(result: SDKResultMessage): string {
  if (result.subtype === 'success') return result.result ?? ''
  return result.errors?.join('\n') || `Remote session ended with ${result.subtype}`
}

export function verdictFromOutput(output: string): string | null {
  const match = /\bVERDICT\s*:\s*(PASS|PARTIAL|FAIL)\b/giu.exec(output)
  return match?.[1]?.toUpperCase() ?? null
}

function summarizeEvents(events: SDKMessage[]): string {
  const lines: string[] = []
  for (const event of events) {
    if (
      event.type === 'assistant' &&
      'message' in event &&
      event.message &&
      typeof event.message === 'object' &&
      Array.isArray((event.message as { content?: unknown }).content)
    ) {
      for (const block of (event.message as { content: unknown[] }).content) {
        if (
          block &&
          typeof block === 'object' &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string' &&
          (block as { text: string }).text.trim()
        ) {
          lines.push((block as { text: string }).text)
        }
      }
      continue
    }
    if (event.type === 'result') {
      const output = resultOutput(event)
      if (output.trim()) lines.push(output)
    }
  }
  return lines.join('\n').trim()
}

export function createDefaultManagedCloudClient(): ManagedCloudClient {
  return {
    async start(input) {
      const { teleportToRemote } = await import('../../utils/teleport.js')
      const created = await teleportToRemote({
        initialMessage: input.prompt,
        description: input.prompt,
        title: `Cloud ${input.taskId}/${input.candidateId}`,
        model: input.model,
        permissionMode: input.permissionMode,
        signal: input.signal,
        useDefaultEnvironment: input.environmentId === undefined,
        environmentId: input.environmentId,
      })
      if (!created) {
        throw new Error('Managed cloud session creation failed')
      }
      return { sessionId: created.id, title: created.title }
    },

    async inspect(sessionId, cursor) {
      const { pollRemoteSessionEvents } = await import('../../utils/teleport.js')
      const response = await pollRemoteSessionEvents(sessionId, cursor ?? null)
      const events = response.newEvents as SDKMessage[]
      const terminal = events.findLast(
        (event): event is SDKResultMessage => event.type === 'result',
      )
      const output = terminal ? resultOutput(terminal) : summarizeEvents(events)
      if (terminal) {
        return {
          status: terminal.subtype === 'success' ? 'completed' : 'failed',
          cursor: response.lastEventId,
          branch: response.branch,
          output,
          verdict: verdictFromOutput(output),
          events,
          error:
            terminal.subtype === 'success'
              ? undefined
              : output || `Remote session ended with ${terminal.subtype}`,
        }
      }
      if (response.sessionStatus === 'archived') {
        return {
          status: 'failed',
          cursor: response.lastEventId,
          branch: response.branch,
          output,
          verdict: verdictFromOutput(output),
          events,
          error:
            'Managed session was archived without a successful completion result',
        }
      }
      return {
        status: 'running',
        cursor: response.lastEventId,
        branch: response.branch,
        output,
        verdict: verdictFromOutput(output),
        events,
      }
    },

    async steer(sessionId, message, requestId) {
      const { sendEventToRemoteSession } = await import('../../utils/teleport/api.js')
      return sendEventToRemoteSession(sessionId, message, {
        uuid: requestId || randomUUID(),
      })
    },

    async cancel(sessionId) {
      const { archiveRemoteSession } = await import('../../utils/teleport.js')
      await archiveRemoteSession(sessionId)
    },
  }
}
