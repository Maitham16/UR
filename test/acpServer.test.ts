import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcpClient } from '../src/services/agents/acpClient.js'
import {
  getAcpServerPort,
  serveAcp,
  stopAcpServer,
} from '../src/services/agents/acpServer.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function withAcpServer(
  dir: string,
  token: string | undefined,
  fn: (port: number, client: AcpClient) => Promise<void>,
): Promise<void> {
  const port = 0 // let Bun pick a free port
  // Start the server in the background; it never resolves on its own.
  serveAcp({
    host: '127.0.0.1',
    port,
    token,
    cwd: dir,
  }).catch(() => {})
  // Wait for the server to start and register its port.
  while (getAcpServerPort() === null) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  const actualPort = getAcpServerPort()!
  const client = new AcpClient({ baseUrl: `http://127.0.0.1:${actualPort}`, token })
  try {
    await fn(actualPort, client)
  } finally {
    await stopAcpServer()
  }
}

describe('ACP server', () => {
  test('healthz returns ok', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, undefined, async port => {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.result.ok).toBe(true)
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('initialize returns server metadata', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, undefined, async (_port, client) => {
        const result = (await client.call('initialize')) as {
          name: string
          protocolVersion: string
        }
        expect(result.name).toBe('ur-agent')
        expect(result.protocolVersion).toBe('0.1.0')
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('tools/list returns built-in tools', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, undefined, async (_port, client) => {
        const result = (await client.call('tools/list')) as { tools: Array<{ name: string }> }
        const names = result.tools.map(t => t.name)
        expect(names).toContain('Bash')
        expect(names).toContain('Read')
        expect(names).toContain('Glob')
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects unauthorized requests when token is configured', async () => {
    const dir = tempDir('ur-acp-')
    try {
      await withAcpServer(dir, 'secret-token', async (port) => {
        const badClient = new AcpClient({ baseUrl: `http://127.0.0.1:${port}` })
        await expect(badClient.call('initialize')).rejects.toThrow('ACP error -32001')

        const goodClient = new AcpClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'secret-token' })
        const result = (await goodClient.call('initialize')) as { name: string }
        expect(result.name).toBe('ur-agent')
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
