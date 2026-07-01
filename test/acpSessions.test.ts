import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
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
