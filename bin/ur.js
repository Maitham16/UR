#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entrypoint = resolve(packageRoot, 'src/entrypoints/cli.tsx')
const bundledEntrypoint = resolve(packageRoot, 'dist/cli.js')
const preload = resolve(packageRoot, 'plugins/bunBundleDev.ts')
const packageJsonPath = resolve(packageRoot, 'package.json')

function readPackageMetadata() {
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch {
    return {}
  }
}

function defineMacro(name, value) {
  return `${name}=${value === undefined ? 'undefined' : JSON.stringify(value)}`
}

const packageMetadata = readPackageMetadata()
const version =
  typeof packageMetadata.version === 'string'
    ? packageMetadata.version
    : '0.0.0-dev'
const packageName =
  typeof packageMetadata.name === 'string' ? packageMetadata.name : 'ur-agent'
const issuesUrl =
  typeof packageMetadata.bugs?.url === 'string'
    ? packageMetadata.bugs.url
    : 'https://github.com/Maitham16/UR/issues'

const bun = process.env.BUN_BIN || process.env.BUN_EXECUTABLE || 'bun'
const ollamaModel =
  process.env.OLLAMA_MODEL || process.env.UR_MODEL
const userArgs = process.argv.slice(2)

function argValue(flag, fallback) {
  const index = userArgs.indexOf(flag)
  return index === -1 ? fallback : (userArgs[index + 1] ?? fallback)
}

function isLoopback(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body, null, 2))
}

function readJson(req) {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function buildAgentCard(baseUrl) {
  return {
    protocolVersion: '0.3.0',
    name: 'UR-AGENT',
    description:
      'Local-first terminal coding agent powered through the local Ollama app, with MCP tools, custom agents, browser workflows, memory, verifier gates, and permission controls.',
    url: `${baseUrl}/a2a`,
    version,
    documentationUrl:
      'https://github.com/Maitham16/UR/blob/master/docs/AGENT_TRENDS.md',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text/plain', 'text/markdown', 'application/json'],
    defaultOutputModes: ['text/plain', 'text/markdown', 'application/json'],
    provider: {
      organization: 'Maitham Al-rubaye',
      url: 'https://github.com/Maitham16/UR',
    },
    skills: [
      {
        id: 'coding-agent',
        name: 'Coding Agent',
        description:
          'Read, edit, test, verify, and explain code inside a local workspace with permission controls.',
        tags: ['coding', 'terminal', 'verification'],
        examples: [
          'Fix this failing test and run the relevant checks.',
          'Review the current diff for behavioral regressions.',
        ],
        inputModes: ['text/plain', 'text/markdown'],
        outputModes: ['text/plain', 'text/markdown'],
      },
    ],
  }
}

function runAgentPrompt(prompt) {
  const childArgs = existsSync(bundledEntrypoint)
    ? [bundledEntrypoint, '-p', '--output-format', 'json', prompt]
    : [
        'run',
        '--preload',
        preload,
        '--define',
        defineMacro('MACRO.VERSION', version),
        '--define',
        defineMacro('MACRO.BUILD_TIME', ''),
        '--define',
        defineMacro('MACRO.PACKAGE_URL', packageName),
        '--define',
        defineMacro('MACRO.NATIVE_PACKAGE_URL', undefined),
        '--define',
        defineMacro('MACRO.FEEDBACK_CHANNEL', issuesUrl),
        '--define',
        defineMacro('MACRO.ISSUES_EXPLAINER', `file an issue at ${issuesUrl}`),
        '--define',
        defineMacro('MACRO.VERSION_CHANGELOG', ''),
        entrypoint,
        '-p',
        '--output-format',
        'json',
        prompt,
      ]

  return new Promise(resolve => {
    const child = spawn(bun, childArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(ollamaModel ? { OLLAMA_MODEL: ollamaModel } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    child.on('error', error => {
      resolve({ code: 1, stdout: '', stderr: error.message })
    })
    child.on('exit', code => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}

function runA2AServer() {
  const host = argValue('--host', '127.0.0.1')
  const port = Number(argValue('--port', '8765'))
  const token = argValue('--token')
  const dryRun = userArgs.includes('--dry-run')
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid --port value: ${argValue('--port')}`)
    process.exit(1)
  }
  if (!isLoopback(host) && !token) {
    console.error('Refusing to bind a2a server off-loopback without --token')
    process.exit(1)
  }

  const baseUrl = `http://${host}:${port}`
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', baseUrl)
    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true })
      return
    }
    if (
      req.method === 'GET' &&
      (url.pathname === '/.well-known/agent-card.json' ||
        url.pathname === '/agent-card.json')
    ) {
      sendJson(res, 200, buildAgentCard(baseUrl))
      return
    }
    if (req.method === 'POST' && url.pathname === '/a2a/tasks') {
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
      const body = await readJson(req)
      const prompt =
        body && typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (!prompt) {
        sendJson(res, 400, { error: 'missing prompt' })
        return
      }
      const command = [bun, bundledEntrypoint, '-p', '--output-format', 'json', prompt]
      if (dryRun) {
        sendJson(res, 200, { dryRun: true, command })
        return
      }
      const result = await runAgentPrompt(prompt)
      sendJson(res, result.code === 0 ? 200 : 500, result)
      return
    }
    sendJson(res, 404, { error: 'not found' })
  })
  server.listen(port, host, () => {
    const actual = server.address()
    const actualPort = actual && typeof actual === 'object' ? actual.port : port
    console.log(`A2A server listening on http://${host}:${actualPort}`)
  })
}

const args =
  existsSync(bundledEntrypoint)
    ? [bundledEntrypoint, ...userArgs]
    : [
        'run',
        '--preload',
        preload,
        '--define',
        defineMacro('MACRO.VERSION', version),
        '--define',
        defineMacro('MACRO.BUILD_TIME', ''),
        '--define',
        defineMacro('MACRO.PACKAGE_URL', packageName),
        '--define',
        defineMacro('MACRO.NATIVE_PACKAGE_URL', undefined),
        '--define',
        defineMacro('MACRO.FEEDBACK_CHANNEL', issuesUrl),
        '--define',
        defineMacro('MACRO.ISSUES_EXPLAINER', `file an issue at ${issuesUrl}`),
        '--define',
        defineMacro('MACRO.VERSION_CHANGELOG', ''),
        entrypoint,
        ...userArgs,
      ]

const child = spawn(bun, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...(ollamaModel ? { OLLAMA_MODEL: ollamaModel } : {}),
  },
  stdio: 'inherit',
})

child.on('error', error => {
  if (error.code === 'ENOENT') {
    console.error(
      'UR-AGENT requires Bun to run. Install Bun from https://bun.sh, then retry.',
    )
    process.exit(1)
  }

  console.error(error.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
