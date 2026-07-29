// Historical compatibility shape only. This distribution has no monitor-task
// constructor or lifecycle implementation; keep the discriminator parseable so
// persisted transcripts from another build remain renderable.
import type { TaskStateBase } from '../../Task.js'

/** @deprecated Persisted-state compatibility only; never create at runtime. */
export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  isBackgrounded?: boolean
}
