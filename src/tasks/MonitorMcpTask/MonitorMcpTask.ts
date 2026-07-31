// Stub: implementation not included in this distribution, but persisted task
// consumers still rely on the shared task-state fields.
import type { TaskStateBase } from '../../Task.js'

export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  isBackgrounded?: boolean
}
