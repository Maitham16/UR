// Historical compatibility shape only. This distribution has no workflow-task
// constructor or lifecycle implementation; keep the discriminator parseable so
// persisted transcripts from another build remain renderable.
import type { TaskStateBase } from '../../Task.js'

/** @deprecated Persisted-state compatibility only; never create at runtime. */
export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  isBackgrounded?: boolean
}
