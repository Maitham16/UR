import {
  DEFAULT_PROMPT_PLANNING_CONFIG,
  resolvePromptPlanningConfig,
} from './config.js'
import type {
  NexusAgentRole,
  NexusRiskLevel,
  NexusTask,
  PromptPlan,
  PromptPlanningConfig,
} from './types.js'
import { isAbsolute } from 'node:path'

const URL_PATTERN = /\bhttps?:\/\/[^\s)]+/gi
const PATH_PATTERN =
  /(?:^|[\s"'`(])((?:\.{0,2}\/)?(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@/-]+|(?:README|CHANGELOG|RELEASE|SECURITY|CONTRIBUTING|QUALITY|LICENSE)(?:\.[A-Za-z0-9]+)?)\b/g
const ABSOLUTE_PATH_PATTERN =
  /(?:^|[\s"'`(])((?:\/[A-Za-z0-9_.@-]+)+\/?)(?=$|[\s"',.;:)])/g
const DESTRUCTIVE_PATTERN =
  /\b(rm\s+-[A-Za-z]*r|rm\s+-[A-Za-z]*f|delete|remove|wipe|destroy|drop\s+(?:database|table)|git\s+reset\s+--hard|mkfs|chmod\s+-R\s+777|chown\s+-R)\b/i
const WRITE_PATTERN =
  /\b(write|modify|edit|update|delete|remove|rm|move|rename|chmod|chown|overwrite)\b/i
const READ_PATTERN = /\b(read|inspect|view|cat|open|list|show)\b/i
const NETWORK_PATTERN =
  /\b(curl|wget|ssh|scp|rsync|git\s+push|npm\s+(?:publish|install)|bun\s+add|kubectl|terraform\s+apply|deploy|production|cloud)\b/i
const CREDENTIAL_PATTERN =
  /\b(credential|api\s*key|secret|token|password|oauth|\.env)\b/i
const SECURITY_PATTERN =
  /\b(pentest|penetration\s+test|exploit|sqlmap|nmap|metasploit|payload|vulnerabilit(?:y|ies)|cve|xss|csrf|rce|security\s+scan|attack)\b/i
const AUTHORIZED_SECURITY_PATTERN =
  /\b(authorized|authorization|owned|own\s+system|my\s+(?:app|site|server|service)|localhost|127\.0\.0\.1|::1|lab|sandbox|ctf|test\s+target)\b/i

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function titleFromSegment(segment: string): string {
  const cleaned = compact(segment)
    .replace(/^please\s+/i, '')
    .replace(/[.?!]+$/g, '')
  if (cleaned.length <= 64) return cleaned || 'Clarify requested work'
  return `${cleaned.slice(0, 61).trim()}...`
}

function extractUrls(text: string): string[] {
  return unique([...text.matchAll(URL_PATTERN)].map(match => match[0]))
}

export function extractReferencedFiles(text: string): string[] {
  const paths: string[] = []
  for (const match of text.matchAll(PATH_PATTERN)) {
    const value = match[1]
    if (!value) continue
    if (value.includes('://')) continue
    paths.push(value.replace(/[),.;:]+$/g, ''))
  }
  for (const match of text.matchAll(ABSOLUTE_PATH_PATTERN)) {
    const value = match[1]
    if (!value) continue
    paths.push(value.replace(/[),.;:]+$/g, ''))
  }
  return unique(paths)
}

function splitNumberedOrBulletedLines(prompt: string): string[] {
  const segments: string[] = []
  for (const line of prompt.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/)
    if (match?.[1]) segments.push(match[1])
  }
  return segments.length >= 2 ? segments.map(compact) : []
}

function splitLongPrompt(prompt: string): string[] {
  const bulletSegments = splitNumberedOrBulletedLines(prompt)
  if (bulletSegments.length > 0) return bulletSegments

  const trimmed = compact(prompt)
  if (trimmed.length < 220 && !/[;\n]/.test(prompt)) return [trimmed]

  const lines = prompt
    .split(/\r?\n+/)
    .map(compact)
    .filter(Boolean)
  if (lines.length >= 2) return lines

  const sentenceSegments = trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(compact)
    .filter(Boolean)
  if (sentenceSegments.length >= 2) return sentenceSegments

  const directiveSegments = trimmed
    .split(/\s+(?:then|also|next|finally)\s+/i)
    .map(compact)
    .filter(Boolean)
  return directiveSegments.length >= 2 ? directiveSegments : [trimmed]
}

function needsPreviousTask(segment: string): boolean {
  return /^(then|after|next|finally|verify|validate|test|run tests|summari[sz]e|report)\b/i.test(
    segment,
  )
}

function inferRole(segment: string): NexusAgentRole {
  if (/\b(plan|analy[sz]e|decompose)\b/i.test(segment)) return 'planner'
  if (/\b(verify|validate|test|check|prove)\b/i.test(segment)) return 'verifier'
  if (/\b(report|summari[sz]e|release notes|changelog)\b/i.test(segment)) {
    return 'reporter'
  }
  return 'executor'
}

function isCriticallyAmbiguous(segment: string): boolean {
  const text = compact(segment).toLowerCase()
  if (!text) return true
  return /^(do|fix|update|improve|change|make|handle|clean up)(\s+(it|this|that|things?|stuff|everything))?\.?$/.test(
    text,
  )
}

function extractCommand(segment: string): string | undefined {
  const backtickCommand = segment.match(/`([^`]+)`/)?.[1]
  if (backtickCommand) return compact(backtickCommand)

  const runCommand = segment.match(/\b(?:run|execute)\s+(.+)$/i)?.[1]
  if (runCommand && /(?:\s|^)(?:rm|curl|wget|nmap|sqlmap|git|npm|bun|ssh|scp|kubectl|terraform)\b/.test(runCommand)) {
    return compact(runCommand)
  }

  if (
    DESTRUCTIVE_PATTERN.test(segment) ||
    NETWORK_PATTERN.test(segment) ||
    SECURITY_PATTERN.test(segment)
  ) {
    return compact(segment)
  }
  return undefined
}

function isOutsideReadOnly(segment: string, outsidePaths: string[]): boolean {
  return outsidePaths.length > 0 && READ_PATTERN.test(segment) && !WRITE_PATTERN.test(segment)
}

function riskSignals(segment: string, outsidePaths: string[]): string[] {
  const signals: string[] = []
  if (DESTRUCTIVE_PATTERN.test(segment)) signals.push('destructive command')
  if (NETWORK_PATTERN.test(segment)) signals.push('network or external-system action')
  if (CREDENTIAL_PATTERN.test(segment)) signals.push('credential-sensitive access')
  if (SECURITY_PATTERN.test(segment)) signals.push('security research scope')
  if (outsidePaths.length > 0 && !isOutsideReadOnly(segment, outsidePaths)) {
    signals.push('outside-workspace modification')
  }
  return signals
}

function riskLevel(signals: string[], files: string[]): NexusRiskLevel {
  if (signals.length > 0) return 'high'
  if (files.length > 3) return 'medium'
  return 'low'
}

function approvalReasonFor(
  segment: string,
  signals: string[],
  outsidePaths: string[],
): string | undefined {
  if (signals.length === 0) return undefined
  if (SECURITY_PATTERN.test(segment) && !AUTHORIZED_SECURITY_PATTERN.test(segment)) {
    return 'Security research needs target scope and authorization confirmation before execution.'
  }
  if (outsidePaths.length > 0 && !isOutsideReadOnly(segment, outsidePaths)) {
    return 'Modifying or deleting outside-workspace paths requires explicit approval.'
  }
  if (DESTRUCTIVE_PATTERN.test(segment)) {
    return 'Destructive commands require explicit approval before execution.'
  }
  if (NETWORK_PATTERN.test(segment)) {
    return 'Network or external-system actions require explicit approval before execution.'
  }
  if (CREDENTIAL_PATTERN.test(segment)) {
    return 'Credential-sensitive access requires explicit approval before execution.'
  }
  return 'This task requires explicit approval before execution.'
}

function verificationCriteria(segment: string, files: string[]): string[] {
  const criteria = [
    `Result directly addresses: ${compact(segment)}`,
    'Assumptions are stated before execution when context is incomplete.',
    'Unsupported claims are rejected during verification.',
    'Approval-required actions are not executed before approval evidence exists.',
  ]
  if (files.length > 0) {
    criteria.push('Referenced files exist before file-specific work starts.')
    criteria.push('Any claimed file changes are backed by actual changed files.')
  }
  return criteria
}

function makeTask(
  segment: string,
  index: number,
  previousTaskId: string | null,
): NexusTask {
  const files = extractReferencedFiles(segment)
  const outsidePaths = files.filter(file => isAbsolute(file))
  const signals = riskSignals(segment, outsidePaths)
  const approvalRequired = signals.length > 0
  const approvalReason = approvalReasonFor(segment, signals, outsidePaths)
  const command = extractCommand(segment)
  const needsScope =
    SECURITY_PATTERN.test(segment) && !AUTHORIZED_SECURITY_PATTERN.test(segment)
  const needsContext = isCriticallyAmbiguous(segment)
  const dependencies =
    previousTaskId && needsPreviousTask(segment) ? [previousTaskId] : []
  const assumptions = needsContext
    ? ['Critical target/context is missing; ask for clarification before execution.']
    : [
        'Use the current workspace as the source of truth.',
        files.length === 0
          ? 'No specific files were named; discover relevant files before changing code.'
          : 'Only touch referenced files unless repository inspection proves another file is required.',
      ]

  return {
    id: `task-${index + 1}`,
    order: index + 1,
    title: titleFromSegment(segment),
    description: compact(segment) || 'Clarify the requested work.',
    status: needsContext
      ? 'needs-context'
      : needsScope
        ? 'needs-scope'
        : approvalRequired
          ? 'waiting-approval'
          : dependencies.length > 0 ? 'pending' : 'ready',
    dependencies,
    assignedAgent: inferRole(segment),
    input: {
      prompt: segment,
      assumptions,
      requiredFiles: files,
      targetFiles: files,
      resources: extractUrls(segment),
    },
    expectedOutput: needsContext
      ? 'A clarification request naming the missing target or context.'
      : `Completed work for: ${compact(segment)}`,
    verificationCriteria: verificationCriteria(segment, files),
    fileTargets: files,
    riskLevel: riskLevel(signals, files),
    approvalRequired,
    approvalReason,
    approvalAction: approvalRequired
      ? compact(segment) || 'Approval-required task'
      : undefined,
    approvalCommand: command,
    approvalPaths: outsidePaths,
    outsideWorkspacePaths: outsidePaths,
  }
}

export function decomposePrompt(
  prompt: string,
  config?: Partial<PromptPlanningConfig>,
): PromptPlan {
  const resolvedConfig = {
    ...DEFAULT_PROMPT_PLANNING_CONFIG,
    ...resolvePromptPlanningConfig(config),
  }
  const originalPrompt = prompt
  const segments = splitLongPrompt(prompt).filter(Boolean)
  const sourceSegments = segments.length > 0 ? segments : ['']
  let previousTaskId: string | null = null
  const tasks = sourceSegments.map((segment, index) => {
    const task = makeTask(segment, index, previousTaskId)
    previousTaskId = task.id
    return task
  })

  return {
    id: `plan-${Date.now().toString(36)}`,
    originalPrompt,
    tasks,
    assumptions: unique(tasks.flatMap(task => task.input.assumptions)),
    createdAt: new Date().toISOString(),
    config: resolvedConfig,
  }
}
