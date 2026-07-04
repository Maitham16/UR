import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type {
  NexusTask,
  TaskClaim,
  TaskExecutionResult,
  TaskValidationContext,
  TaskValidationResult,
  VerificationIssue,
} from './types.js'

function issue(
  code: string,
  message: string,
  severity: VerificationIssue['severity'] = 'error',
  value?: string,
): VerificationIssue {
  return value ? { code, message, severity, value } : { code, message, severity }
}

function normalizeSet(values?: Iterable<string>): Set<string> {
  return new Set([...(values ?? [])].map(value => value.trim()).filter(Boolean))
}

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map(value => value.trim()).filter(Boolean))]
}

function fileExists(cwd: string, file: string, knownFiles: Set<string>): boolean {
  if (knownFiles.has(file)) return true
  return existsSync(isAbsolute(file) ? file : join(cwd, file))
}

export function extractClaims(output: string): TaskClaim[] {
  const claims: TaskClaim[] = []
  const filePattern =
    /\b(?:changed|updated|edited|created|wrote|modified)\s+`?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`?/gi
  for (const match of output.matchAll(filePattern)) {
    if (match[1]) claims.push({ type: 'fileChanged', value: match[1] })
  }

  const commandPattern = /\b(?:ran|executed)\s+`([^`]+)`/gi
  for (const match of output.matchAll(commandPattern)) {
    if (match[1]) claims.push({ type: 'commandRun', value: match[1] })
  }

  return claims
}

export function validateBeforeExecution(
  task: NexusTask,
  context: TaskValidationContext,
): TaskValidationResult {
  const issues: VerificationIssue[] = []
  const knownFiles = normalizeSet(context.existingFiles)

  if (task.approvalRequired) {
    issues.push(
      issue(
        'approval_required',
        `${task.id} cannot continue safely without approval: ${
          task.approvalReason ?? 'explicit approval is required'
        }`,
      ),
    )
  }
  if (task.status === 'blocked' || task.status === 'needs-context') {
    issues.push(
      issue('needs_context', `${task.id} needs context before execution.`),
    )
  }
  if (task.status === 'needs-scope') {
    issues.push(
      issue(
        'needs_scope',
        `${task.id} needs target scope and authorization confirmation before execution.`,
      ),
    )
  }
  if (task.status === 'paused-review') {
    issues.push(
      issue('paused_for_review', `${task.id} is paused for review.`),
    )
  }
  if (task.status === 'skipped') {
    issues.push(
      issue('skipped_by_policy', `${task.id} was skipped by policy.`),
    )
  }
  if (task.input.assumptions.length === 0) {
    issues.push(
      issue('missing_assumptions', `${task.id} has no explicit assumptions.`),
    )
  }

  for (const file of task.input.requiredFiles) {
    if (!fileExists(context.cwd, file, knownFiles)) {
      issues.push(
        issue(
          'missing_required_file',
          `${task.id} references missing required file: ${file}`,
        ),
      )
    }
  }

  const errors = issues.filter(entry => entry.severity === 'error')
  return { ok: errors.length === 0, blocked: errors.length > 0, issues }
}

function commandWasRun(claimed: string, commandsRun: Set<string>): boolean {
  if (commandsRun.has(claimed)) return true
  for (const command of commandsRun) {
    if (command.includes(claimed) || claimed.includes(command)) return true
  }
  return false
}

export function validateAfterExecution(
  task: NexusTask,
  result: TaskExecutionResult,
  context: TaskValidationContext,
): TaskValidationResult {
  const issues: VerificationIssue[] = []
  const strict = context.strict !== false
  const hasObservedFileEvidence =
    context.actualChangedFiles !== undefined ||
    result.observedChangedFiles !== undefined
  const actualChangedFiles = normalizeSet(
    hasObservedFileEvidence
      ? [
          ...(context.actualChangedFiles ?? []),
          ...(result.observedChangedFiles ?? []),
        ]
      : [
          ...(result.changedFiles ?? []),
          ...(result.observedChangedFiles ?? []),
        ],
  )
  const commandsRun = normalizeSet([
    ...(context.commandsRun ?? []),
    ...(result.commandsRun ?? []),
    ...(result.observedCommands ?? []),
  ])
  const output = result.output ?? context.output ?? ''
  const claims = [...(result.claims ?? []), ...extractClaims(output)]
  const reportedChangedFiles = unique([
    ...(result.reportedChangedFiles ?? []),
    ...(hasObservedFileEvidence ? result.changedFiles ?? [] : []),
    ...claims
      .filter((claim): claim is Extract<TaskClaim, { type: 'fileChanged' }> => claim.type === 'fileChanged')
      .map(claim => claim.value),
  ])
  const reportedCommands = unique([
    ...(result.reportedCommands ?? []),
    ...claims
      .filter((claim): claim is Extract<TaskClaim, { type: 'commandRun' }> => claim.type === 'commandRun')
      .map(claim => claim.value),
  ])
  const unsupportedSeverity: VerificationIssue['severity'] = strict
    ? 'error'
    : 'warning'

  if (!result.ok) {
    issues.push(
      issue(
        'execution_failed',
        result.error
          ? `${task.id} execution failed: ${result.error}`
          : `${task.id} execution failed.`,
      ),
    )
  }

  for (const file of reportedChangedFiles) {
    if (!actualChangedFiles.has(file)) {
      issues.push(
        issue(
          'unsupported_file_change_claim',
          `${task.id} reported a file change that was not observed: ${file}`,
          unsupportedSeverity,
          file,
        ),
      )
    }
  }

  for (const file of actualChangedFiles) {
    if (!reportedChangedFiles.includes(file)) {
      issues.push(
        issue(
          'unreported_file_change',
          `${task.id} changed a file without reporting it: ${file}`,
          'warning',
          file,
        ),
      )
    }
  }

  for (const command of reportedCommands) {
    if (!commandWasRun(command, commandsRun)) {
      issues.push(
        issue(
          'unsupported_command_claim',
          `${task.id} claimed a command that was not observed: ${command}`,
          unsupportedSeverity,
          command,
        ),
      )
    }
  }

  if (
    strict &&
    result.ok &&
    output.trim().length === 0 &&
    actualChangedFiles.size === 0 &&
    commandsRun.size === 0
  ) {
    issues.push(
      issue(
        'empty_verified_output',
        `${task.id} produced no output, file changes, or command evidence.`,
      ),
    )
  }

  const errors = issues.filter(entry => entry.severity === 'error')
  return { ok: errors.length === 0, blocked: false, issues }
}
