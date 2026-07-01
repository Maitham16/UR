/**
 * Stdio Agent Client Protocol (ACP) agent.
 * Speaks newline-delimited JSON-RPC over stdio so ACP editors (Zed, ACP-capable
 * Neovim clients) can launch UR with `ur acp stdio`. Streaming is delivered via
 * session/update notifications. I/O and the prompt runner are injectable for tests.
 */

import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'

export type AcpStdioMessage = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type AcpStdioWriter = (message: AcpStdioMessage) => void

export type AcpPromptRunner = (
  prompt: string,
  ctx: {
    sessionId: string
    cwd: string
    signal: AbortSignal
    onChunk: (text: string) => void
  },
) => Promise<{ stopReason: string }>

function extractPromptText(prompt: unknown): string {
  if (typeof prompt === 'string') return prompt
  if (!Array.isArray(prompt)) return ''
  return prompt
    .map(block => {
      if (typeof block === 'string') return block
      if (block && typeof block === 'object') {
        const b = block as { type?: string; text?: string }
        if (b.type === 'text' || b.text) return b.text ?? ''
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

const defaultPromptRunner: AcpPromptRunner = async (prompt, ctx) => {
  const result = await execFileNoThrowWithCwd(
    process.execPath,
    [process.argv[1] ?? '', '-p', '--output-format', 'text', prompt],
    { cwd: ctx.cwd, timeout: 30 * 60 * 1000, preserveOutputOnError: true },
  )
  const text = (result.stdout || result.stderr || result.error || '').trim()
  if (text) ctx.onChunk(text)
  return { stopReason: result.code === 0 ? 'end_turn' : 'refusal' }
}

export function createAcpStdioAgent(deps: {
  write: AcpStdioWriter
  cwd: string
  runPrompt?: AcpPromptRunner
}) {
  const sessions = new Map<string, { cwd: string; controller: AbortController }>()
  const runPrompt = deps.runPrompt ?? defaultPromptRunner

  const respond = (id: AcpStdioMessage['id'], result: unknown) =>
    deps.write({ jsonrpc: '2.0', id: id ?? null, result })
  const respondError = (id: AcpStdioMessage['id'], code: number, message: string) =>
    deps.write({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
  const notify = (method: string, params: Record<string, unknown>) =>
    deps.write({ jsonrpc: '2.0', method, params })

  async function handle(message: AcpStdioMessage): Promise<void> {
    const { id, method, params } = message
    if (typeof method !== 'string') return // a response/ack from the client
    const hasId = id !== undefined && id !== null
    try {
      switch (method) {
        case 'initialize':
          respond(id, {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
              promptCapabilities: { image: false, audio: false, embeddedContext: true },
            },
            authMethods: [],
          })
          return
        case 'authenticate':
          respond(id, {})
          return
        case 'session/new': {
          const cwd = typeof params?.cwd === 'string' ? params.cwd : deps.cwd
          const sessionId = `sess_${randomUUID()}`
          sessions.set(sessionId, { cwd, controller: new AbortController() })
          respond(id, { sessionId })
          return
        }
        case 'session/prompt': {
          const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : ''
          const session = sessions.get(sessionId)
          if (!session) {
            respondError(id, -32602, `unknown session: ${sessionId}`)
            return
          }
          const controller = new AbortController()
          session.controller = controller
          const { stopReason } = await runPrompt(extractPromptText(params?.prompt), {
            sessionId,
            cwd: session.cwd,
            signal: controller.signal,
            onChunk: text =>
              notify('session/update', {
                sessionId,
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
              }),
          })
          respond(id, { stopReason: controller.signal.aborted ? 'cancelled' : stopReason })
          return
        }
        case 'session/cancel': {
          const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : ''
          sessions.get(sessionId)?.controller.abort()
          if (hasId) respond(id, { cancelled: true })
          return
        }
        case 'shutdown':
          if (hasId) respond(id, null)
          return
        default:
          if (hasId) respondError(id, -32601, `method not found: ${method}`)
      }
    } catch (error) {
      if (hasId) respondError(id, -32603, error instanceof Error ? error.message : String(error))
    }
  }

  return { handle, sessions }
}

export async function startAcpStdioAgent(options: { cwd: string }): Promise<void> {
  const agent = createAcpStdioAgent({
    cwd: options.cwd,
    write: message => process.stdout.write(`${JSON.stringify(message)}\n`),
  })
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      await agent.handle(JSON.parse(trimmed) as AcpStdioMessage)
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`,
      )
    }
  }
}
