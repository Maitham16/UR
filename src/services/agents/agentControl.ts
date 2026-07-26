import { randomUUID } from 'node:crypto'
import {
  getBackgroundTask,
  steerBackgroundTask,
  stopBackgroundTask,
} from './backgroundRunner.js'
import {
  cancelCloudTask,
  getCloudTask,
  steerCloudTask,
} from './cloudTasks.js'

export type AgentControlTarget =
  | { kind: 'background'; id: string }
  | { kind: 'cloud'; id: string }
  | { kind: 'remote'; id: string }

export type AgentControlReceipt = {
  accepted: boolean
  duplicate?: boolean
  requestId: string
  target: AgentControlTarget
  deliveredTo?: string[]
  reason?: string
}

export type RemoteAgentControlClient = {
  steer(sessionId: string, message: string, requestId: string): Promise<boolean>
  cancel(sessionId: string): Promise<void>
}

function defaultRemoteClient(): RemoteAgentControlClient {
  return {
    async steer(sessionId, message, requestId) {
      const { sendEventToRemoteSession } = await import('../../utils/teleport/api.js')
      return sendEventToRemoteSession(sessionId, message, { uuid: requestId })
    },
    async cancel(sessionId) {
      const { archiveRemoteSession } = await import('../../utils/teleport.js')
      await archiveRemoteSession(sessionId)
    },
  }
}

export async function steerAgent(
  cwd: string,
  target: AgentControlTarget,
  message: string,
  options: {
    requestId?: string
    actor?: string
    remoteClient?: RemoteAgentControlClient
  } = {},
): Promise<AgentControlReceipt> {
  const requestId = options.requestId ?? randomUUID()
  if (target.kind === 'background') {
    const result = steerBackgroundTask(cwd, target.id, message, {
      requestId,
      actor: options.actor,
    })
    return {
      ...result,
      target,
    }
  }
  if (target.kind === 'cloud') {
    const result = await steerCloudTask(cwd, target.id, message, { requestId })
    return {
      ...result,
      target,
    }
  }
  const accepted = await (options.remoteClient ?? defaultRemoteClient()).steer(
    target.id,
    message,
    requestId,
  )
  return {
    accepted,
    requestId,
    target,
    deliveredTo: accepted ? [target.id] : [],
    ...(!accepted ? { reason: 'remote session rejected the message' } : {}),
  }
}

export async function cancelAgent(
  cwd: string,
  target: AgentControlTarget,
  options: { remoteClient?: RemoteAgentControlClient } = {},
): Promise<AgentControlReceipt> {
  const requestId = randomUUID()
  if (target.kind === 'background') {
    const task = stopBackgroundTask(cwd, target.id)
    return {
      accepted: task !== null,
      requestId,
      target,
      ...(!task ? { reason: 'task not found' } : {}),
    }
  }
  if (target.kind === 'cloud') {
    const task = await cancelCloudTask(cwd, target.id)
    return {
      accepted: task !== null,
      requestId,
      target,
      ...(!task ? { reason: 'task not found' } : {}),
    }
  }
  await (options.remoteClient ?? defaultRemoteClient()).cancel(target.id)
  return { accepted: true, requestId, target }
}

export function inspectAgent(
  cwd: string,
  target: Exclude<AgentControlTarget, { kind: 'remote' }>,
): unknown {
  return target.kind === 'background'
    ? getBackgroundTask(cwd, target.id)
    : getCloudTask(cwd, target.id)
}
