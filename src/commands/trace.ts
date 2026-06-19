import type { Command, LocalCommandCall } from '../types/command.js'

const DEFAULT_DEPTH = 8
const MAX_DEPTH = 50
const TEXT_PREVIEW_CHARS = 200

type MessageLike = {
  type?: string
  uuid?: string
  isMeta?: boolean
  message?: {
    role?: string
    content?: unknown
  }
}

const call: LocalCommandCall = async (args, context) => {
  const messages = (context.messages ?? []) as MessageLike[]
  const depth = parseDepth(args)
  if (messages.length === 0) {
    return { type: 'text', value: 'No messages in this session yet.' }
  }
  const slice = messages.slice(-depth)
  const lines: string[] = []
  lines.push(`=== Trace: last ${slice.length} of ${messages.length} messages ===`)
  let i = messages.length - slice.length
  for (const msg of slice) {
    i++
    lines.push(renderOne(i, msg))
  }
  return { type: 'text', value: lines.join('\n') }
}

function parseDepth(args: string): number {
  const trimmed = args.trim()
  if (!trimmed) return DEFAULT_DEPTH
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DEPTH
  return Math.min(Math.floor(n), MAX_DEPTH)
}

function renderOne(index: number, msg: MessageLike): string {
  const role = msg.message?.role ?? msg.type ?? 'unknown'
  const uuid = msg.uuid ? msg.uuid.slice(0, 8) : '--------'
  const metaTag = msg.isMeta ? ' [meta]' : ''
  const header = `\n[${index}] ${role.padEnd(10)} ${uuid}${metaTag}`
  const content = msg.message?.content
  if (typeof content === 'string') {
    return `${header}\n     text: ${preview(content)}`
  }
  if (!Array.isArray(content)) {
    return `${header}\n     (no content)`
  }
  const parts: string[] = []
  for (const block of content) {
    const b = block as {
      type?: string
      text?: string
      name?: string
      input?: unknown
      tool_use_id?: string
      is_error?: boolean
      content?: unknown
    }
    if (b.type === 'text' && typeof b.text === 'string') {
      const t = b.text
      const verdict = extractVerdict(t)
      if (verdict) parts.push(`text: ${preview(t)}\n     verdict: ${verdict}`)
      else parts.push(`text: ${preview(t)}`)
    } else if (b.type === 'tool_use') {
      const inputPreview = preview(JSON.stringify(b.input ?? {}), 120)
      parts.push(`tool_use: ${b.name ?? '?'}(${inputPreview})`)
    } else if (b.type === 'tool_result') {
      const errFlag = b.is_error ? ' ERROR' : ''
      const body =
        typeof b.content === 'string'
          ? b.content
          : Array.isArray(b.content)
            ? (b.content as Array<{ text?: string }>)
                .map(x => (typeof x.text === 'string' ? x.text : ''))
                .join('')
            : ''
      parts.push(`tool_result${errFlag} (id=${b.tool_use_id ?? '?'}): ${preview(body, 120)}`)
    } else if (b.type) {
      parts.push(`${b.type}: ${preview(JSON.stringify(b), 120)}`)
    }
  }
  return [header, ...parts.map(p => `     ${p}`)].join('\n')
}

function preview(text: string, max = TEXT_PREVIEW_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}… [+${t.length - max} chars]`
}

const VERDICT_RE = /\bVERDICT:\s*(PASS|FAIL|PARTIAL)\b/i
function extractVerdict(text: string): string | null {
  const m = VERDICT_RE.exec(text)
  return m ? m[1].toUpperCase() : null
}

const trace = {
  type: 'local',
  name: 'trace',
  description:
    'Inspect the most recent turns in this session. Shows roles, tool calls, ' +
    'tool results, verifier verdicts. Pass a number to widen the window (default 8, max 50).',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default trace
