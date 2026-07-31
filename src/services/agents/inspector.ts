import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'
import { getCanonicalName } from '../../utils/model/model.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { MODEL_COSTS } from '../../utils/modelCost.js'
import { calculateCostFromTokens } from '../../utils/modelCost.js'

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
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    model?: string
  }
  // Subagent transcripts are written to
  // {sessionId}/subagents/agent-{agentId}.jsonl, so a run's own turns carry
  // its id. Without it a fan-out's spend can only be seen as one total.
  agentId?: string
}

export type AgentRun = {
  index: number
  subagentType: string
  description: string
  promptPreview: string
  resultPreview: string
  status: 'ok' | 'error' | 'pending'
  verdict: 'PASS' | 'FAIL' | 'PARTIAL' | null
  usage: AgentUsage
}

export type AgentUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
  model: string | null
}

function emptyUsage(): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
    model: null,
  }
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
  costUSD: number
  // Main-thread spend. Reported separately so the per-agent rows always sum
  // to the total — a breakdown that silently loses cost is worse than none.
  mainThreadCostUSD: number
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
    costUSD: 0,
    mainThreadCostUSD: 0,
  }
  const agents: AgentRun[] = []
  const pendingById = new Map<string, AgentRun>()
  // A run's own turns appear after the tool_use that spawned it, tagged with
  // its agentId. Index by id so usage lands on the right row.
  const byAgentId = new Map<string, AgentRun>()

  for (const message of messages) {
    const role = message.message?.role ?? message.type
    if (role === 'assistant') summary.assistantTurns++
    const usage = message.message?.usage
    if (usage) {
      summary.tokens.input += usage.input_tokens ?? 0
      summary.tokens.output += usage.output_tokens ?? 0
      const tokens = {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      }
      const model = message.message?.model ?? null
      // An unknown model prices at 0 rather than throwing: a missing price
      // must not take down the whole report.
      const cost = model ? calculateCostFromTokens(model, tokens) : 0
      summary.costUSD += cost
      const owner = message.agentId ? byAgentId.get(message.agentId) : undefined
      if (owner) {
        owner.usage.inputTokens += tokens.inputTokens
        owner.usage.outputTokens += tokens.outputTokens
        owner.usage.cacheReadInputTokens += tokens.cacheReadInputTokens
        owner.usage.cacheCreationInputTokens += tokens.cacheCreationInputTokens
        owner.usage.costUSD += cost
        owner.usage.model ??= model
      } else {
        summary.mainThreadCostUSD += cost
      }
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
            usage: emptyUsage(),
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

/**
 * Per-agent spend for one session.
 *
 * A subagent's turns are never in the parent transcript — they are written to
 * `{sessionId}/subagents/agent-{agentId}.jsonl`. stats.ts already reads those
 * files, but only to fold their tokens into a single total, so a fan-out that
 * burned most of a session's budget looked identical to one that did not.
 *
 * Attribution is by filename rather than by joining turns back to the spawning
 * `tool_use`: the Agent tool's input carries no agent id, so any such join
 * would be a guess. Every message in `agent-X.jsonl` belongs to agent X.
 */
export type SubagentCost = {
  agentId: string
  /** From the sidecar agent-{id}.meta.json. A bare hex id tells you which
   * agent was expensive but not what it was doing, which is half an
   * attribution. */
  agentType: string | null
  description: string | null
  model: string | null
  messages: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
  /**
   * Tracks whether this row has any reliably priced model usage.
   *
   * We purposely suppress fabricated estimates for unknown models and local
   * runtimes so we only show a cost when provider billing is real.
   */
  hasReliableCosting?: boolean
}

export function summarizeSubagentCosts(subagentsDir: string): SubagentCost[] {
  let entries: string[]
  try {
    entries = readdirSync(subagentsDir)
  } catch {
    return []
  }
  const rows: SubagentCost[] = []
  for (const entry of entries.sort()) {
    const matched = /^agent-(.+)\.jsonl$/.exec(entry)
    if (!matched) continue
    let messages: MessageLike[]
    try {
      messages = loadTranscript(join(subagentsDir, entry))
    } catch {
      // One unreadable transcript must not blank the whole report.
      continue
    }
    const meta = readAgentMetadata(join(subagentsDir, entry))
    const row: SubagentCost = {
      agentId: matched[1]!,
      agentType: meta.agentType,
      description: meta.description,
      model: null,
      messages: messages.length,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
    }
    for (const message of messages) {
      const usage = message.message?.usage
      if (!usage) continue
      const tokens = {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      }
      row.inputTokens += tokens.inputTokens
      row.outputTokens += tokens.outputTokens
      row.cacheReadInputTokens += tokens.cacheReadInputTokens
      row.cacheCreationInputTokens += tokens.cacheCreationInputTokens
      const model = message.message?.model ?? null
      row.model ??= model
      if (
        model &&
        getAPIProvider() !== 'ollama' &&
        Object.prototype.hasOwnProperty.call(MODEL_COSTS, getCanonicalName(model))
      ) {
        // Unknown models are common with tool/agent model aliases; we do not
        // invent a price for them.
        row.hasReliableCosting = true
        row.costUSD += calculateCostFromTokens(model, tokens)
      }
    }
    rows.push(row)
  }
  return rows.sort((a, b) => b.costUSD - a.costUSD)
}

/**
 * The sidecar written next to each transcript. Missing or malformed metadata
 * degrades to nulls: an unlabelled row is still worth showing, and this runs
 * over historical sessions whose metadata predates the description field.
 */
function readAgentMetadata(transcriptPath: string): {
  agentType: string | null
  description: string | null
} {
  try {
    const raw = readFileSync(
      transcriptPath.replace(/\.jsonl$/, '.meta.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw) as {
      agentType?: unknown
      description?: unknown
    }
    return {
      agentType:
        typeof parsed.agentType === 'string' ? parsed.agentType : null,
      description:
        typeof parsed.description === 'string' ? parsed.description : null,
    }
  } catch {
    return { agentType: null, description: null }
  }
}

export function formatSubagentCosts(
  rows: SubagentCost[],
  json: boolean,
  searchedDir?: string,
): string {
  if (json) return JSON.stringify({ subagents: rows, searchedDir }, null, 2)
  if (rows.length === 0) {
    // Naming the directory is the difference between "this session had no
    // fan-out" and "I resolved the wrong path"; without it both read the same.
    return searchedDir
      ? `No subagent transcripts in ${searchedDir}.\nEither this session spawned no subagents, or that is not where they were written.`
      : 'No subagent transcripts found for this session.'
  }
  // Some runtimes and some model names have no reliable cost model; those rows
  // must not show fabricated "$0.00". Only rows with known pricing emit money.
  const billed = rows.some((row) => row.costUSD > 0)
  const total = rows.reduce((sum, row) => sum + row.costUSD, 0)
  // Prefer the human label; fall back to the id when metadata is absent.
  const label = (row: SubagentCost) =>
    row.description || row.agentType || row.agentId
  const width = Math.min(
    Math.max(...rows.map(row => label(row).length), 5),
    44,
  )
  const lines = ['Per-agent usage', '']
  for (const row of rows) {
    const cost = billed ? `  ${formatUSD(row.costUSD).padStart(9)}` : ''
    lines.push(
      `  ${label(row).slice(0, width).padEnd(width)}  ${String(row.inputTokens).padStart(9)} in  ` +
        `${String(row.outputTokens).padStart(8)} out${cost}  ${row.model ?? 'unknown model'}`,
    )
  }
  const totalIn = rows.reduce((sum, row) => sum + row.inputTokens, 0)
  const totalOut = rows.reduce((sum, row) => sum + row.outputTokens, 0)
  lines.push(
    `  ${'-'.repeat(width)}  ${'-'.repeat(12)}  ${'-'.repeat(12)}`,
    `  ${'total'.padEnd(width)}  ${String(totalIn).padStart(9)} in  ` +
      `${String(totalOut).padStart(8)} out${billed ? `  ${formatUSD(total).padStart(9)}` : ''}`,
  )
  if (!billed) {
    lines.push('', 'Cost omitted: the active runtime is local and unbilled.')
  }
  return lines.join('\n')
}

function formatUSD(value: number): string {
  // Sub-cent runs are common with local models; showing $0.00 for everything
  // would make the breakdown useless.
  return value > 0 && value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`
}
