import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { UrRemoteClient } from '../src/sdk/index.js'
import { createAcpHttpSessionManager } from '../src/services/agents/acpHttpSessions.js'
import { handleAcpRequest } from '../src/services/agents/acpServer.js'

test('Node and Python SDKs use real authenticated persisted ACP sessions with approval and replay', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-sdk-acp-'))
  let approvals = 0, runs = 0
  const token = 'sdk-integration-operator'
  const manager = createAcpHttpSessionManager({ cwd, token, runPrompt: async (_prompt, ctx) => {
    runs++
    if (_prompt === 'wait for cancellation') {
      await ctx.onChunk('waiting')
      await new Promise<void>(resolve => { if (ctx.signal.aborted) resolve(); else ctx.signal.addEventListener('abort', () => resolve(), { once: true }) })
      return { stopReason: 'cancelled' }
    }
    await ctx.onChunk('Before approval')
    const decision = await ctx.requestPermission({ toolCall: { toolCallId: 'sdk-tool', title: 'Read fixture', kind: 'read', status: 'pending', rawInput: { path: 'fixture' } }, options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' }] })
    if (decision.outcome.outcome === 'selected' && decision.outcome.optionId === 'allow_once') approvals++
    await ctx.onChunk('こんにちは café العربية')
    return { stopReason: 'end_turn', resumeSessionId: ctx.sessionId }
  } })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: req => handleAcpRequest(req, { host: '127.0.0.1', port: 0, cwd, token, sessionManager: manager }) })
  try {
    const remote = new UrRemoteClient({ endpoint: `http://127.0.0.1:${server.port}/acp`, token })
    const run = await remote.stream('fixture only')
    const events = []
    for await (const envelope of run) {
      events.push(envelope)
      if (envelope.event.type === 'permission') await run.approve(String(envelope.event.requestId), { behavior: 'allow' })
    }
    expect((await run.result).ok).toBe(true)
    expect(approvals).toBe(1)
    expect(JSON.stringify(events)).toContain('こんにちは café العربية')
    const resumed = await remote.resume(run.sessionId, run.lastSequence)
    for await (const _ of resumed) {}
    expect((await resumed.result).ok).toBe(true)
    expect(runs).toBe(1)
    await expect(new UrRemoteClient({ endpoint: `http://127.0.0.1:${server.port}/acp`, token: 'incorrect' }).newSession()).rejects.toThrow()
    const code = `from ur_agent import RemoteClient\nr=RemoteClient(${JSON.stringify(`http://127.0.0.1:${server.port}/acp`)},${JSON.stringify(token)})\nrun=r.stream('python fixture')\nfor frame in run:\n if frame['event']['type']=='permission': run.approve(frame['event']['requestId'],{'behavior':'allow'})\nassert run.result['ok'],run.result\nprint('python remote passed')`
    const child = spawn('python3', ['-c', code], { env: { ...process.env, PYTHONPATH: join(process.cwd(), 'sdk-python') }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', errors = ''
    child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { errors += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    const status = await new Promise<number | null>(resolve => child.on('close', resolve)); clearTimeout(timer)
    expect(status, errors).toBe(0)
    expect(output.trim()).toBe('python remote passed')
    expect(approvals).toBe(2)
    expect(runs).toBe(2)
    await remote.close(run.sessionId)
    const reopened = await remote.resume(run.sessionId, run.lastSequence)
    for await (const _ of reopened) {}
    expect((await reopened.result).ok).toBe(true)
    expect(reopened.sessionId).toBe(run.sessionId)
    expect(runs).toBe(2)
    const waiting = await remote.stream('wait for cancellation')
    for await (const _ of waiting) { await waiting.cancel(); break }
    expect((await waiting.result).canceled).toBe(true)
    expect((await waiting.result).ok).toBe(false)
  } finally { await manager.stop(); server.stop(true); rmSync(cwd, { recursive: true, force: true }) }
}, 60_000)
