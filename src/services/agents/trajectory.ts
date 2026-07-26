import { createHash } from 'node:crypto'
import { safeParseJSON } from '../../utils/json.js'

export type TrajectoryEventKind =
  | 'tool_call'
  | 'tool_result'
  | 'permission_denial'
  | 'result'

export type TrajectoryEvent = {
  index: number
  kind: TrajectoryEventKind
  tool?: string
  callId?: string
  success?: boolean
}

export type EvalTrajectory = {
  version: 1
  events: TrajectoryEvent[]
  tools: string[]
  toolCalls: number
  failedToolCalls: number
  permissionDenials: number
  turns: number
  isError: boolean
  malformedLines: number
  truncated: boolean
}

export type TrajectoryExpectation = {
  requiredTools?: string[]
  forbiddenTools?: string[]
  orderedTools?: string[]
  requireSuccessfulTools?: string[]
  minToolCalls?: number
  maxToolCalls?: number
  maxFailedToolCalls?: number
  maxRepeatedToolCalls?: number
  maxPermissionDenials?: number
  maxTurns?: number
}

export type TrajectoryCheck = {
  name: string
  passed: boolean
  detail?: string
}

export type TrajectoryGrade = {
  score: number
  passed: boolean
  checks: TrajectoryCheck[]
}

export const MAX_TRAJECTORY_EVENTS = 2_000
export const MAX_STREAM_JSON_BYTES = 10 * 1024 * 1024

const TOOL_ALIASES: Record<string, string> = {
  fileread: 'Read',
  readfile: 'Read',
  filewrite: 'Write',
  writefile: 'Write',
  fileedit: 'Edit',
  editfile: 'Edit',
  grepsearch: 'Grep',
  globsearch: 'Glob',
  shell: 'Bash',
  terminal: 'Bash',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeTrajectoryTool(value: unknown): string {
  if (typeof value !== 'string') return 'Unknown'
  const clean = value.replace(/[^\w:.-]/g, '').slice(0, 128) || 'Unknown'
  return TOOL_ALIASES[clean.toLowerCase()] ?? clean
}

function opaqueId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function contentBlocks(message: unknown): unknown[] {
  const content = record(message).content
  return Array.isArray(content) ? content : []
}

/**
 * Extract only control-flow metadata. Prompts, tool inputs/results, assistant
 * text, paths, and secrets are deliberately never retained.
 */
export function captureTrajectory(messages: unknown[]): EvalTrajectory {
  const events: TrajectoryEvent[] = []
  const calls = new Map<string, string>()
  let turns = 0
  let reportedTurns: number | undefined
  let permissionDenials = 0
  let isError = false
  let truncated = false

  const push = (event: Omit<TrajectoryEvent, 'index'>): void => {
    if (events.length >= MAX_TRAJECTORY_EVENTS) {
      truncated = true
      return
    }
    events.push({ index: events.length, ...event })
  }

  for (const raw of messages) {
    const item = record(raw)
    const type = typeof item.type === 'string' ? item.type : ''
    if (type === 'assistant') {
      turns += 1
      for (const rawBlock of contentBlocks(item.message)) {
        const block = record(rawBlock)
        if (block.type !== 'tool_use') continue
        const tool = normalizeTrajectoryTool(block.name)
        const rawId = typeof block.id === 'string' ? block.id : ''
        if (rawId) calls.set(rawId, tool)
        push({ kind: 'tool_call', tool, callId: opaqueId(rawId) })
      }
    } else if (type === 'user') {
      for (const rawBlock of contentBlocks(item.message)) {
        const block = record(rawBlock)
        if (block.type !== 'tool_result') continue
        const rawId =
          typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
        push({
          kind: 'tool_result',
          tool: calls.get(rawId) ?? 'Unknown',
          callId: opaqueId(rawId),
          success: block.is_error !== true,
        })
      }
    } else if (type === 'result') {
      if (typeof item.num_turns === 'number') {
        reportedTurns = Math.max(0, Math.floor(item.num_turns))
      }
      isError = item.is_error === true || item.subtype !== 'success'
      const denials = Array.isArray(item.permission_denials)
        ? item.permission_denials
        : []
      permissionDenials += denials.length
      for (const denial of denials) {
        const value = record(denial)
        push({
          kind: 'permission_denial',
          tool: normalizeTrajectoryTool(value.tool_name),
          callId: opaqueId(value.tool_use_id),
          success: false,
        })
      }
      push({ kind: 'result', success: !isError })
    }
  }

  const tools = events
    .filter(event => event.kind === 'tool_call')
    .map(event => event.tool ?? 'Unknown')
  const failedToolCalls = events.filter(
    event => event.kind === 'tool_result' && event.success === false,
  ).length
  return {
    version: 1,
    events,
    tools,
    toolCalls: tools.length,
    failedToolCalls,
    permissionDenials,
    turns: reportedTurns ?? turns,
    isError,
    malformedLines: 0,
    truncated,
  }
}

export function parseStreamJsonTrajectory(stdout: string): {
  output: string
  trajectory: EvalTrajectory
} {
  const encoded = Buffer.from(stdout)
  const wasTruncated = encoded.byteLength > MAX_STREAM_JSON_BYTES
  const bounded = wasTruncated
    ? encoded.subarray(0, MAX_STREAM_JSON_BYTES).toString('utf8')
    : stdout
  const messages: unknown[] = []
  let malformedLines = 0
  let output = ''
  for (const line of bounded.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parsed = safeParseJSON(line, false)
    if (!parsed || typeof parsed !== 'object') {
      malformedLines += 1
      continue
    }
    messages.push(parsed)
    const item = parsed as Record<string, unknown>
    if (item.type === 'result' && typeof item.result === 'string') {
      output = item.result
    }
  }
  const trajectory = captureTrajectory(messages)
  trajectory.malformedLines = malformedLines
  if (wasTruncated) trajectory.truncated = true
  return { output, trajectory }
}

function subsequence(needle: string[], haystack: string[]): boolean {
  let index = 0
  for (const item of haystack) {
    if (index < needle.length && item === needle[index]) index += 1
  }
  return index === needle.length
}

export function gradeCapturedTrajectory(
  trajectory: EvalTrajectory | undefined,
  expect: TrajectoryExpectation,
): TrajectoryGrade {
  const checks: TrajectoryCheck[] = []
  const wanted =
    (expect.requiredTools?.length ?? 0) +
      (expect.forbiddenTools?.length ?? 0) +
      (expect.orderedTools?.length ?? 0) +
      (expect.requireSuccessfulTools?.length ?? 0) >
      0 ||
    [
      expect.minToolCalls,
      expect.maxToolCalls,
      expect.maxFailedToolCalls,
      expect.maxRepeatedToolCalls,
      expect.maxPermissionDenials,
      expect.maxTurns,
    ].some(value => typeof value === 'number')
  if (!wanted) return { score: 1, passed: true, checks }
  if (!trajectory) {
    return {
      score: 0,
      passed: false,
      checks: [
        {
          name: 'trajectory available',
          passed: false,
          detail: 'runner did not capture a trajectory',
        },
      ],
    }
  }
  const captureComplete =
    !trajectory.truncated && trajectory.malformedLines === 0
  checks.push({
    name: 'trajectory capture complete',
    passed: captureComplete,
    detail: captureComplete
      ? undefined
      : [
          trajectory.truncated ? 'capture was truncated' : '',
          trajectory.malformedLines > 0
            ? `${trajectory.malformedLines} malformed stream line(s)`
            : '',
        ]
          .filter(Boolean)
          .join('; '),
  })
  const tools = trajectory.tools
  for (const tool of expect.requiredTools ?? []) {
    checks.push({ name: `uses ${tool}`, passed: tools.includes(tool) })
  }
  for (const tool of expect.forbiddenTools ?? []) {
    checks.push({
      name: `does not use ${tool}`,
      passed: !tools.includes(tool),
    })
  }
  if (expect.orderedTools?.length) {
    checks.push({
      name: `tool order ${expect.orderedTools.join(' → ')}`,
      passed: subsequence(expect.orderedTools, tools),
    })
  }
  const successes = new Set(
    trajectory.events
      .filter(event => event.kind === 'tool_result' && event.success)
      .map(event => event.tool),
  )
  for (const tool of expect.requireSuccessfulTools ?? []) {
    checks.push({
      name: `successful ${tool}`,
      passed: successes.has(tool),
    })
  }
  if (typeof expect.minToolCalls === 'number') {
    checks.push({
      name: `≥ ${expect.minToolCalls} tool calls`,
      passed: trajectory.toolCalls >= expect.minToolCalls,
      detail: `${trajectory.toolCalls} tool calls`,
    })
  }
  if (typeof expect.maxToolCalls === 'number') {
    checks.push({
      name: `≤ ${expect.maxToolCalls} steps`,
      passed: trajectory.toolCalls <= expect.maxToolCalls,
      detail: `${trajectory.toolCalls} tool calls`,
    })
  }
  if (typeof expect.maxFailedToolCalls === 'number') {
    checks.push({
      name: `≤ ${expect.maxFailedToolCalls} failed tool calls`,
      passed: trajectory.failedToolCalls <= expect.maxFailedToolCalls,
      detail: `${trajectory.failedToolCalls} failed`,
    })
  }
  if (typeof expect.maxRepeatedToolCalls === 'number') {
    const counts = new Map<string, number>()
    for (const tool of tools) counts.set(tool, (counts.get(tool) ?? 0) + 1)
    const repeats = Math.max(0, ...[...counts.values()].map(count => count - 1))
    checks.push({
      name: `≤ ${expect.maxRepeatedToolCalls} repeated calls per tool`,
      passed: repeats <= expect.maxRepeatedToolCalls,
      detail: `${repeats} repeats`,
    })
  }
  if (typeof expect.maxPermissionDenials === 'number') {
    checks.push({
      name: `≤ ${expect.maxPermissionDenials} permission denials`,
      passed: trajectory.permissionDenials <= expect.maxPermissionDenials,
      detail: `${trajectory.permissionDenials} denials`,
    })
  }
  if (typeof expect.maxTurns === 'number') {
    checks.push({
      name: `≤ ${expect.maxTurns} turns`,
      passed: trajectory.turns <= expect.maxTurns,
      detail: `${trajectory.turns} turns`,
    })
  }
  const passed = checks.filter(check => check.passed).length
  return {
    score: checks.length > 0 ? Number((passed / checks.length).toFixed(4)) : 1,
    passed: checks.every(check => check.passed),
    checks,
  }
}
