export type NexusTaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'waiting-approval'
  | 'needs-scope'
  | 'needs-context'
  | 'paused-review'
  | 'skipped'
  | 'finished'
  | 'failed'

export type NexusAgentRole = 'planner' | 'executor' | 'verifier' | 'reporter'
export type NexusRiskLevel = 'low' | 'medium' | 'high'
export type TaskApprovalStatus =
  | 'not-required'
  | 'waiting-approval'
  | 'approved'
  | 'skipped-by-policy'

export type TaskApprovalDecision = {
  taskId: string
  taskTitle: string
  status: TaskApprovalStatus
  reason: string
  action: string
  command?: string
  paths: string[]
}

export type NexusTaskInput = {
  prompt: string
  assumptions: string[]
  requiredFiles: string[]
  targetFiles: string[]
  resources: string[]
}

export type NexusTask = {
  id: string
  order: number
  title: string
  description: string
  status: NexusTaskStatus
  dependencies: string[]
  assignedAgent: NexusAgentRole | string
  input: NexusTaskInput
  expectedOutput: string
  verificationCriteria: string[]
  fileTargets: string[]
  riskLevel: NexusRiskLevel
  approvalRequired: boolean
  approvalReason?: string
  approvalAction?: string
  approvalCommand?: string
  approvalPaths: string[]
  outsideWorkspacePaths: string[]
}

export type PromptPlanningConfig = {
  taskPlanning: boolean
  parallelAgents: boolean
  maxAgents: number
  showTaskBoard: boolean
  strictVerification: boolean
}

export type PromptPlan = {
  id: string
  originalPrompt: string
  tasks: NexusTask[]
  assumptions: string[]
  createdAt: string
  config: PromptPlanningConfig
}

export type TaskClaim =
  | { type: 'fileChanged'; value: string }
  | { type: 'commandRun'; value: string }
  | { type: 'output'; value: string }

export type TaskExecutionResult = {
  ok: boolean
  output?: string
  /**
   * Backward-compatible executor-reported changed files. When workspace
   * snapshots are available these are verified against observed changes.
   */
  changedFiles?: string[]
  reportedChangedFiles?: string[]
  observedChangedFiles?: string[]
  /**
   * Backward-compatible observed commands executed by the task runner.
   */
  commandsRun?: string[]
  reportedCommands?: string[]
  observedCommands?: string[]
  outsideWorkspaceReads?: string[]
  outsideWorkspaceWrites?: string[]
  approvalDecisions?: TaskApprovalDecision[]
  claims?: TaskClaim[]
  error?: string
}

export type VerificationIssue = {
  code: string
  message: string
  severity: 'warning' | 'error'
  value?: string
}

export type TaskValidationContext = {
  cwd: string
  existingFiles?: Iterable<string>
  actualChangedFiles?: Iterable<string>
  commandsRun?: Iterable<string>
  output?: string
  strict?: boolean
}

export type TaskValidationResult = {
  ok: boolean
  blocked: boolean
  issues: VerificationIssue[]
}

export type TaskExecutionEvent =
  | { type: 'status'; task: NexusTask; tasks: NexusTask[] }
  | { type: 'board'; board: string; tasks: NexusTask[] }

export type TaskExecutor = (task: NexusTask) => Promise<TaskExecutionResult>

export type RunPromptPlanOptions = {
  cwd: string
  config?: Partial<PromptPlanningConfig>
  executeTask: TaskExecutor
  onEvent?: (event: TaskExecutionEvent) => void
}

export type RunPromptPlanResult = {
  tasks: NexusTask[]
  finished: number
  failed: number
  blocked: number
  waitingApproval: number
  skipped: number
  maxAgentsAllowed: number
  maxAgentsUsed: number
  approvalDecisions: TaskApprovalDecision[]
  outsideWorkspaceReads: string[]
  outsideWorkspaceWrites: string[]
  taskResults: TaskRunRecord[]
}

export type TaskRunRecord = {
  taskId: string
  task: NexusTask
  startedAt?: string
  finishedAt?: string
  execution?: TaskExecutionResult
  actualChangedFiles: string[]
  reportedChangedFiles: string[]
  unreportedChangedFiles: string[]
  observedCommands: string[]
  reportedCommands: string[]
  unverifiedCommandClaims: string[]
  outsideWorkspaceReads: string[]
  outsideWorkspaceWrites: string[]
  approvalDecisions: TaskApprovalDecision[]
  preVerification: TaskValidationResult
  postVerification?: TaskValidationResult
}
