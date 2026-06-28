import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { buildA2AAgentCard } from './trends.js'

type ServeOptions = {
  host: string
  port: number
  token?: string
  dryRun?: boolean
  cwd: string
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function authorized(request: Request, token: string | undefined): boolean {
  if (!token) return true
  return request.headers.get('authorization') === `Bearer ${token}`
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

async function handleRequest(
  request: Request,
  options: ServeOptions,
  baseUrl: string,
): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return jsonResponse(200, { ok: true })
  }
  if (
    request.method === 'GET' &&
    (url.pathname === '/.well-known/agent-card.json' ||
      url.pathname === '/agent-card.json')
  ) {
    return jsonResponse(200, buildA2AAgentCard({ baseUrl }))
  }
  if (request.method === 'POST' && url.pathname === '/a2a/tasks') {
    if (!authorized(request, options.token)) {
      return jsonResponse(401, { error: 'unauthorized' })
    }
    const body = (await request.json().catch(() => null)) as {
      prompt?: unknown
    } | null
    const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
    if (!prompt.trim()) {
      return jsonResponse(400, { error: 'missing prompt' })
    }
    const command = [
      process.execPath,
      process.argv[1] ?? '',
      '-p',
      '--output-format',
      'json',
      prompt,
    ]
    if (options.dryRun) {
      return jsonResponse(200, { dryRun: true, command })
    }
    const result = await execFileNoThrowWithCwd(command[0]!, command.slice(1), {
      cwd: options.cwd,
      timeout: 30 * 60 * 1000,
      preserveOutputOnError: true,
    })
    return jsonResponse(result.code === 0 ? 200 : 500, {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr || result.error,
    })
  }
  return jsonResponse(404, { error: 'not found' })
}

export async function serveA2A(options: ServeOptions): Promise<void> {
  if (!isLoopback(options.host) && !options.token) {
    throw new Error('Refusing to bind a2a server off-loopback without --token')
  }
  if (typeof Bun === 'undefined' || typeof Bun.serve !== 'function') {
    throw new Error('A2A server requires the Bun runtime')
  }

  const baseUrl = `http://${options.host}:${options.port}`
  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: request => handleRequest(request, options, baseUrl),
  })

  // biome-ignore lint/suspicious/noConsole:: CLI command output
  console.log(`A2A server listening on http://${options.host}:${server.port}`)
  await new Promise(() => {
    // Keep process alive until interrupted.
  })
}
