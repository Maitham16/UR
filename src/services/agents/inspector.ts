import { existsSync, readFileSync } from 'node:fs'
import { safeParseJSON } from '../../utils/json.js'

/**
 * Agent-run inspector.
 *
 * Reads a session transcript (interactive message log or a JSONL file) and
 * reconstructs a per-subagent timeline: which agents were spawned, with what
 * prompt, what they returned, the tool calls along the way, verifier verdicts,
 * errors, and token usage. This is the terminal-native equivalent of a visual
 * agent-debugging surface — a step-through view layered on top of /trace.
 */

const AGENT_TOOL_NAMES = new Set(['Agent', 'Task'])
const PREVIEW_CHARS = 160

export type ContentBlock = {
  type?: string
  text?: string
  name?: string
  input?: Record<string, unknown>
  id?: string
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}

export type MessageLike = {
  type?: string
  uuid?: string
  isMeta?: boolean
  message?: {
    role?: string
    content?: unknown
    usage?: { input_tokens?: number; output_tokens?: number }
  }
}

export type AgentRun = {
  index: number
  subagentType: string
  description: string
  promptPreview: string
  resultPreview: string
  status: 'ok' | 'error' | 'pending'
  verdict: 'PASS' | 'FAIL' | 'PARTIAL' | null
}

export type InspectionSummary = {
  messages: number
  assistantTurns: number
  toolCalls: number
  agentRuns: number
  errors: number
  verdicts: { pass: number; fail: number; partial: number }
  tokens: { input: number; output: number }
  toolUsage: Record<string, number>
}

export type InspectionReport = {
  summary: InspectionSummary
  agents: AgentRun[]
}

const VERDICT_RE = /\bVERDICT:\s*(PASS|FAIL|PARTIAL)\b/i

function preview(value: string, max = PREVIEW_CHARS): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}… [+${text.length - max} chars]`
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as ContentBlock[])
      .map(block => (typeof block.text === 'string' ? block.text : ''))
      .join('')
  }
  return ''
}

function extractVerdict(text: string): AgentRun['verdict'] {
  const match = VERDICT_RE.exec(text)
  return match ? (match[1].toUpperCase() as AgentRun['verdict']) : null
}

export function inspectMessages(messages: MessageLike[]): InspectionReport {
  const summary: InspectionSummary = {
    messages: messages.length,
    assistantTurns: 0,
    toolCalls: 0,
    agentRuns: 0,
    errors: 0,
    verdicts: { pass: 0, fail: 0, partial: 0 },
    tokens: { input: 0, output: 0 },
    toolUsage: {},
  }
  const agents: AgentRun[] = []
  const pendingById = new Map<string, AgentRun>()

  for (const message of messages) {
    const role = message.message?.role ?? message.type
    if (role === 'assistant') summary.assistantTurns++
    const usage = message.message?.usage
    if (usage) {
      summary.tokens.input += usage.input_tokens ?? 0
      summary.tokens.output += usage.output_tokens ?? 0
    }

    const content = message.message?.content
    if (!Array.isArray(content)) {
      if (typeof content === 'string') {
        const verdict = extractVerdict(content)
        if (verdict) tallyVerdict(summary, verdict)
      }
      continue
    }

    for (const raw of content as ContentBlock[]) {
      if (raw.type === 'text' && typeof raw.text === 'string') {
        const verdict = extractVerdict(raw.text)
        if (verdict) tallyVerdict(summary, verdict)
      } else if (raw.type === 'tool_use') {
        summary.toolCalls++
        const toolName = raw.name ?? '?'
        summary.toolUsage[toolName] = (summary.toolUsage[toolName] ?? 0) + 1
        if (AGENT_TOOL_NAMES.has(toolName)) {
          summary.agentRuns++
          const input = raw.input ?? {}
          const run: AgentRun = {
            index: summary.agentRuns,
            subagentType: String(input.subagent_type ?? 'general-purpose'),
            description: String(input.description ?? ''),
            promptPreview: preview(String(input.prompt ?? '')),
            resultPreview: '',
            status: 'pending',
            verdict: null,
          }
          agents.push(run)
          if (raw.id) pendingById.set(raw.id, run)
        }
      } else if (raw.type === 'tool_result') {
        if (raw.is_error) summary.errors++
        const id = raw.tool_use_id
        const run = id ? pendingById.get(id) : undefined
        if (run) {
          const body = blockText(raw.content)
          run.resultPreview = preview(body)
          run.status = raw.is_error ? 'error' : 'ok'
          run.verdict = extractVerdict(body)
          if (id) pendingById.delete(id)
        }
      }
    }
  }

  return { summary, agents }
}

function tallyVerdict(summary: InspectionSummary, verdict: AgentRun['verdict']) {
  if (verdict === 'PASS') summary.verdicts.pass++
  else if (verdict === 'FAIL') summary.verdicts.fail++
  else if (verdict === 'PARTIAL') summary.verdicts.partial++
}

/** Load a transcript from a JSONL (one message per line) or JSON array file. */
export function loadTranscript(path: string): MessageLike[] {
  if (!existsSync(path)) {
    throw new Error(`Transcript not found: ${path}`)
  }
  const raw = readFileSync(path, 'utf-8').trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    const parsed = safeParseJSON(raw, false)
    return Array.isArray(parsed) ? (parsed as MessageLike[]) : []
  }
  const out: MessageLike[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = safeParseJSON(trimmed, false)
    if (parsed && typeof parsed === 'object') out.push(parsed as MessageLike)
  }
  return out
}

export function formatInspection(report: InspectionReport, json: boolean): string {
  if (json) return JSON.stringify(report, null, 2)
  const { summary, agents } = report
  const lines = [
    '=== Agent run inspector ===',
    `Messages: ${summary.messages}   Assistant turns: ${summary.assistantTurns}`,
    `Tool calls: ${summary.toolCalls}   Subagent runs: ${summary.agentRuns}   Errors: ${summary.errors}`,
    `Verdicts: PASS ${summary.verdicts.pass} / FAIL ${summary.verdicts.fail} / PARTIAL ${summary.verdicts.partial}`,
    `Tokens: ${summary.tokens.input} in / ${summary.tokens.output} out`,
  ]
  const tools = Object.entries(summary.toolUsage)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}×${count}`)
  if (tools.length > 0) lines.push(`Tool usage: ${tools.join(', ')}`)

  lines.push('')
  if (agents.length === 0) {
    lines.push('No subagent runs found in this transcript.')
    return lines.join('\n')
  }
  lines.push('Subagent timeline:')
  for (const run of agents) {
    const statusMark =
      run.status === 'ok' ? '✓' : run.status === 'error' ? '✗' : '…'
    const verdict = run.verdict ? `  VERDICT: ${run.verdict}` : ''
    lines.push('')
    lines.push(`[${run.index}] ${statusMark} ${run.subagentType}: ${run.description}${verdict}`)
    if (run.promptPreview) lines.push(`     prompt: ${run.promptPreview}`)
    if (run.resultPreview) lines.push(`     result: ${run.resultPreview}`)
  }
  return lines.join('\n')
}
