import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleAcpRequest, stopAcpServer } from '../src/services/agents/acpServer.js'

afterEach(async () => {
  await stopAcpServer()
})

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ur-acp-sess-'))
}

async function rpc(cwd: string, method: string, params?: unknown, dryRun = true) {
  const res = await handleAcpRequest(
    new Request('http://127.0.0.1/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    { host: '127.0.0.1', port: 0, cwd, dryRun },
  )
  return (await res.json()) as { result?: any; error?: any }
}

describe('ACP HTTP sessions + capabilities', () => {
  test('initialize advertises capabilities and workspace root', async () => {
    const dir = tempDir()
    try {
      const body = await rpc(dir, 'initialize')
      expect(body.result.capabilities.sessions).toBe(true)
      expect(body.result.capabilities.cancellation).toBe(true)
      expect(body.result.workspaceRoot).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('session/new returns a session id and workspace root', async () => {
    const dir = tempDir()
    try {
      const body = await rpc(dir, 'session/new')
      expect(body.result.sessionId).toMatch(/^sess_/)
      expect(body.result.workspaceRoot).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('session workspaces are existing directories scoped beneath the server root', async () => {
    const dir = tempDir()
    const outside = tempDir()
    const nested = join(dir, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    try {
      const created = await rpc(dir, 'session/new', { cwd: nested })
      expect(created.result.workspaceRoot).toBe(realpathSync(nested))

      const outsideResult = await rpc(dir, 'session/new', { cwd: outside })
      expect(outsideResult.error.code).toBe(-32602)
      expect(outsideResult.error.message).toContain('server workspace root')

      const relativeResult = await rpc(dir, 'session/new', { cwd: 'packages/app' })
      expect(relativeResult.error.code).toBe(-32602)
      expect(relativeResult.error.message).toContain('absolute path')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('session/prompt on a known session returns a task', async () => {
    const dir = tempDir()
    try {
      const created = await rpc(dir, 'session/new')
      const sessionId = created.result.sessionId
      const body = await rpc(dir, 'session/prompt', { sessionId, prompt: 'Review the README', mode: 'async' })
      expect(body.result.sessionId).toBe(sessionId)
      expect(body.result.task.id).toMatch(/^acp_/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('session/prompt on unknown session errors', async () => {
    const dir = tempDir()
    try {
      const body = await rpc(dir, 'session/prompt', { sessionId: 'sess_nope', prompt: 'hi' })
      expect(body.error.message).toContain('unknown session')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('session/prompt rejects unsupported execution modes', async () => {
    const dir = tempDir()
    try {
      const created = await rpc(dir, 'session/new')
      const body = await rpc(dir, 'session/prompt', {
        sessionId: created.result.sessionId,
        prompt: 'Review the README',
        mode: 'eventually',
      })
      expect(body.error.code).toBe(-32602)
      expect(body.error.message).toContain('mode must be')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('session/cancel validates identifiers and is idempotent for unknown sessions', async () => {
    const dir = tempDir()
    try {
      const missing = await rpc(dir, 'session/cancel')
      expect(missing.error.code).toBe(-32602)

      const unknown = await rpc(dir, 'session/cancel', { sessionId: 'sess_missing' })
      expect(unknown.result).toEqual({
        sessionId: 'sess_missing',
        canceled: false,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('session/close releases a session and is idempotent', async () => {
    const dir = tempDir()
    try {
      const created = await rpc(dir, 'session/new')
      const sessionId = created.result.sessionId
      const closed = await rpc(dir, 'session/close', { sessionId })
      expect(closed.result).toEqual({
        sessionId,
        closed: true,
        canceled: false,
      })

      const closedAgain = await rpc(dir, 'session/close', { sessionId })
      expect(closedAgain.result).toEqual({
        sessionId,
        closed: false,
        canceled: false,
      })
      const prompt = await rpc(dir, 'session/prompt', { sessionId, prompt: 'hi' })
      expect(prompt.error.message).toContain('unknown session')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('shutdown acknowledges', async () => {
    const dir = tempDir()
    try {
      const body = await rpc(dir, 'shutdown')
      expect(body.result.ok).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
