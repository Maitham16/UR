// Stub: implementation not included in this distribution, but persisted task
// consumers still rely on the shared task-state fields.
import type { TaskStateBase } from '../../Task.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  isBackgrounded?: boolean
}
