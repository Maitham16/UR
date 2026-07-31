import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import {
  activeArtifactsServer,
  startArtifactsServer,
} from '../../services/agents/artifactsServer.js'
import { threadsDir } from '../../services/agents/dashboardRoutes.js'
import { getCwd } from '../../utils/cwd.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  getProjectsDir,
  getTranscriptPath,
  getTranscriptPathForSession,
} from '../../utils/sessionStorage.js'

/**
 * Thread sharing (Amp-style): render a session transcript to a static HTML
 * page under .ur/threads and serve it from the local artifacts server, so a
 * teammate on your network (or you, later) can read the whole exchange.
 * Local-first by design — nothing leaves the machine unless you expose the
 * port yourself.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/u

function textOfMessage(m: Record<string, unknown>): string | null {
  const msg = m.message as { role?: string; content?: unknown } | undefined
  if (!msg) return null
  const content = msg.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' && (b as { type?: string }).type === 'text',
      )
      .map(b => b.text)
    return texts.length ? texts.join('\n') : null
  }
  return null
}

function renderThreadHtml(sessionId: string, lines: string[]): string {
  const blocks: string[] = []
  for (const line of lines) {
    const entry = safeParseJSON(line, false) as Record<string, unknown> | null
    if (!entry || typeof entry !== 'object') continue
    const type = entry.type
    if (type !== 'user' && type !== 'assistant') continue
    const text = textOfMessage(entry)
    if (!text || !text.trim()) continue
    const who = type === 'user' ? 'You' : 'UR'
    blocks.push(
      `<div class="${type}"><b>${who}</b><pre>${esc(text.slice(0, 20_000))}</pre></div>`,
    )
  }
  return `<!doctype html><meta charset="utf-8"><title>Thread ${esc(sessionId)}</title>
<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}
pre{white-space:pre-wrap;background:#f7f7f7;padding:8px;border-radius:6px}
.user b{color:#4f46e5}.assistant b{color:#2c7a39}</style>
<body><h1>Thread ${esc(sessionId)}</h1><p><a href="/threads">← all threads</a></p>${blocks.join('\n')}</body>`
}

export const call: LocalCommandCall = async (args: string): Promise<LocalCommandResult> => {
  const cwd = getCwd()
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const action = tokens[0] ?? 'list'

  if (action === 'share') {
    const sessionId = tokens[1]
    if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) {
      return { type: 'text', value: 'Invalid session id.' }
    }
    let transcriptPath = sessionId
      ? getTranscriptPathForSession(sessionId)
      : getTranscriptPath()
    if (!existsSync(transcriptPath)) {
      // Fall back: newest transcript in the project dir.
      const dir = getProjectsDir()
      const candidates = existsSync(dir)
        ? readdirSync(dir).filter(f => f.endsWith('.jsonl'))
        : []
      if (!sessionId && candidates.length === 0) {
        return { type: 'text', value: `No transcript found at ${transcriptPath}.` }
      }
      if (sessionId) {
        return { type: 'text', value: `No transcript for session ${sessionId} (${transcriptPath}).` }
      }
      transcriptPath = candidates
        .map(name => join(dir, name))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!
    }
    const id = sessionId ?? `latest-${Date.now().toString(36)}`
    const lines = readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean)
    mkdirSync(threadsDir(cwd), { recursive: true })
    const out = join(threadsDir(cwd), `${id}.html`)
    writeFileSync(out, renderThreadHtml(id, lines))
    const server =
      activeArtifactsServer() ?? (await startArtifactsServer(cwd).catch(() => null))
    const url = server ? `${server.url}/threads/${id}` : out
    return {
      type: 'text',
      value: `Thread shared: ${url}\n(${lines.length} transcript entries → ${out})`,
    }
  }

  if (action === 'list') {
    const dir = threadsDir(cwd)
    const names = existsSync(dir)
      ? readdirSync(dir).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, ''))
      : []
    if (tokens.includes('--json')) {
      return { type: 'text', value: JSON.stringify({ threads: names }, null, 2) }
    }
    const server = activeArtifactsServer()
    return {
      type: 'text',
      value: names.length
        ? names.map(n => (server ? `${server.url}/threads/${n}` : n)).join('\n')
        : 'No shared threads. Share the current session: ur thread share',
    }
  }

  return { type: 'text', value: 'Usage: ur thread share [sessionId] | list [--json]' }
}
