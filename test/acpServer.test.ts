import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcpClient } from '../src/services/agents/acpClient.js'
import {
  handleAcpRequest,
  stopAcpServer,
} from '../src/services/agents/acpServer.js'

const ACP_TEST_TIMEOUT_MS = 15_000

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function withAcpServer(
  dir: string,
  token: string | undefined,
  fn: (
    port: number,
    client: AcpClient,
    fetchImpl: typeof fetch,
  ) => Promise<void>,
  dryRun = false,
): Promise<void> {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL
      ? input
      : input.url
    return handleAcpRequest(new Request(url, init), {
      host: '127.0.0.1',
      port: 0,
      token,
      cwd: dir,
      dryRun,
    })
  }
  const client = new AcpClient({ baseUrl: 'http://127.0.0.1', token, fetch: fetchImpl })
  try {
    await fn(0, client, fetchImpl)
  } finally {
    await stopAcpServer()
  }
}

describe('ACP server', () => {
  test('healthz returns ok', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, undefined, async (_port, _client, fetchImpl) => {
        const res = await fetchImpl('http://127.0.0.1/healthz')
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.result.ok).toBe(true)
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, ACP_TEST_TIMEOUT_MS)

  test('initialize returns server metadata', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, undefined, async (_port, client) => {
        const result = await client.initialize()
        expect(result.name).toBe('ur-agent')
        expect(result.protocolVersion).toBe('0.1.0')
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, ACP_TEST_TIMEOUT_MS)

  test('tools/list returns built-in tools', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, undefined, async (_port, client) => {
        const names = (await client.listTools()).map(t => t.name)
        expect(names).toContain('Bash')
        expect(names).toContain('Read')
        expect(names).toContain('Glob')
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, ACP_TEST_TIMEOUT_MS)

  test('rejects unauthorized requests when token is configured', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, 'secret-token', async (_port, _client, fetchImpl) => {
        const badClient = new AcpClient({ baseUrl: 'http://127.0.0.1', fetch: fetchImpl })
        await expect(badClient.call('initialize')).rejects.toThrow('ACP error -32001')

        const goodClient = new AcpClient({
          baseUrl: 'http://127.0.0.1',
          token: 'secret-token',
          fetch: fetchImpl,
        })
        const result = (await goodClient.call('initialize')) as { name: string }
        expect(result.name).toBe('ur-agent')
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, ACP_TEST_TIMEOUT_MS)

  test('tasks/send returns a stable task id that tasks/get can fetch', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, undefined, async (_port, client) => {
        const sent = await client.sendTask('Review the README', 'async')
        expect(sent.task.id).toMatch(/^acp_/)
        expect(sent.task.status).toBe('submitted')

        const fetched = await client.getTask(sent.task.id)
        expect(fetched.task.id).toBe(sent.task.id)
        expect(fetched.task.prompt).toBe('Review the README')

        const tasks = await client.listTasks()
        expect(tasks.map(task => task.id)).toContain(sent.task.id)

        const canceled = await client.cancelTask(sent.task.id)
        expect(canceled.task.id).toBe(sent.task.id)
        expect(canceled.task.status).toBe('canceled')
      }, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, ACP_TEST_TIMEOUT_MS)

  test('IDE diff capture and select are available through ACP client/server', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, undefined, async (_port, client) => {
        const diff = [
          'diff --git a/app.ts b/app.ts',
          '--- a/app.ts',
          '+++ b/app.ts',
          '@@ -1 +1 @@',
          '-export const value = 1',
          '+export const value = 2',
          '',
        ].join('\n')
        const captured = (await client.captureIdeDiff({
          title: 'ACP review',
          diff,
        })) as { bundle: { id: string; files: Array<{ path: string }> } }
        expect(captured.bundle.id).toBe('diff-1')
        expect(captured.bundle.files[0]!.path).toBe('app.ts')

        const selected = (await client.selectIdeDiff(captured.bundle.id)) as {
          bundle: { id: string }
          patch: string
        }
        expect(selected.bundle.id).toBe(captured.bundle.id)
        expect(selected.patch).toContain('export const value = 2')
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, ACP_TEST_TIMEOUT_MS)
})
