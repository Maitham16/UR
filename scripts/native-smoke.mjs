#!/usr/bin/env node
// Qualify the installed artifact, not the checkout. The child PATH has no runtimes.
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}
const platform = option('--target', `${process.platform}-${process.arch}`)
const offlineOnly = process.argv.includes('--offline-only')
const source = resolve(root, option('--out-dir', 'dist-native'), platform)
const temporary = mkdtempSync(join(tmpdir(), 'ur native release smoke '))
const installation = join(temporary, 'installed application')
const workspace = join(temporary, 'workspace')
const home = join(temporary, 'home')
const emptyPath = join(temporary, 'empty-path')
for (const path of [workspace, home, emptyPath]) mkdirSync(path, { recursive: true })
const artifactDirectory = option('--artifact-dir')
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const archive = option('--archive', artifactDirectory
  ? resolve(artifactDirectory, `ur-${packageVersion}-${platform}.${platform.startsWith('win32') ? 'zip' : 'tar.gz'}`)
  : undefined)
if (archive) {
  mkdirSync(installation, { recursive: true })
  const safeName = name => {
    const normalized = name.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0') || normalized.split('/').some(part => !part || part === '..' || part === '.') || !(normalized === 'ur' || normalized === 'ur.exe' || normalized === 'resources' || normalized.startsWith('resources/'))) throw new Error(`Unsafe archive path: ${name}`)
    return normalized
  }
  if (archive.endsWith('.zip')) {
    const { unzipSync } = require('fflate')
    let expanded = 0
    const entries = unzipSync(new Uint8Array(readFileSync(archive)), { filter: entry => {
      safeName(entry.name)
      expanded += entry.originalSize
      if (!Number.isSafeInteger(expanded) || expanded > 2 * 1024 * 1024 * 1024) throw new Error('Native archive exceeds extraction size limit')
      return true
    } })
    for (const [name, bytes] of Object.entries(entries)) {
      const normalized = safeName(name)
      if (name.endsWith('/')) continue
      const path = join(installation, normalized)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, bytes)
    }
  } else {
    const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
    for (const name of names) safeName(name)
    if (execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n').some(line => !/^[-d]/.test(line))) throw new Error('Native archive contains links or special files')
    execFileSync('tar', ['-xzf', archive, '-C', installation])
  }
} else cpSync(source, installation, { recursive: true, dereference: true })
const binary = join(installation, process.platform === 'win32' ? 'ur.exe' : 'ur')
const manifest = JSON.parse(readFileSync(join(installation, 'resources', 'manifest.json'), 'utf8'))
if (manifest.version !== packageVersion || manifest.platform !== platform) {
  throw new Error(`Native artifact identity mismatch: expected ${packageVersion}/${platform}, received ${manifest.version}/${manifest.platform}`)
}
const env = {
  PATH: emptyPath,
  HOME: home, USERPROFILE: home,
  USER: 'ur-native-smoke', LOGNAME: 'ur-native-smoke', USERNAME: 'ur-native-smoke',
  APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
  TMPDIR: temporary, TMP: temporary, TEMP: temporary,
  SYSTEMROOT: process.env.SYSTEMROOT ?? process.env.SystemRoot ?? 'C:\\Windows',
  SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows',
  COMSPEC: process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
  SHELL: process.platform === 'win32' ? undefined : '/bin/sh',
  UR_CONFIG_DIR: join(home, '.ur'),
  UR_CODE_TASK_LIST_ID: 'native-release-smoke',
  UR_CODE_ENABLE_TASKS: '1',
  UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
  OPENAI_COMPATIBLE_API_KEY: 'ur-native-smoke-no-secret',
  TERM: 'dumb', NO_COLOR: '1', CI: '1',
}
const results = []
const commandTrace = join(temporary, 'native-commands.jsonl')
const requestTrace = join(temporary, 'provider-requests.jsonl')
const providerDebugFiles = [join(temporary, 'provider-session.debug.log'), join(temporary, 'provider-resume.debug.log')]
writeFileSync(commandTrace, '')
writeFileSync(requestTrace, '')
const trace = (path, event) => appendFileSync(path, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`)

function run(args, timeout = 120_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(binary, args, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
    trace(commandTrace, { event: 'start', command: args[0], pid: child.pid, debugFile: args.includes('--debug-file') ? args[args.indexOf('--debug-file') + 1] : undefined })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { trace(commandTrace, { event: 'timeout', command: args[0], pid: child.pid }); child.kill('SIGKILL'); reject(new Error(`Native command timed out: ${args[0]}; diagnostics: ${temporary}`)) }, timeout)
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 8_000_000) child.kill('SIGKILL') })
    child.stderr.on('data', data => { stderr += data; if (stderr.length > 8_000_000) child.kill('SIGKILL') })
    child.once('error', error => { clearTimeout(timer); trace(commandTrace, { event: 'spawn-error', command: args[0], error: String(error) }); reject(error) })
    child.once('close', code => { clearTimeout(timer); trace(commandTrace, { event: 'close', command: args[0], pid: child.pid, code, stdoutBytes: stdout.length, stderrBytes: stderr.length }); resolveRun({ code, stdout, stderr }) })
  })
}

async function check(name, action) {
  try { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) {
    results.push({ name, passed: false, detail: String(error) })
    console.error(`FAIL ${name}: ${error}`)
    console.error(`Native smoke diagnostics: ${JSON.stringify({ commandTrace, requestTrace, providerDebugFiles: providerDebugFiles.filter(existsSync) })}`)
  }
}

function requireSuccess(result) {
  if (result.code !== 0) throw new Error(`Exit ${result.code}\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}

let server
try {
  await check('installed version without Node or Bun', async () => {
    const output = requireSuccess(await run(['--version']))
    if (output.trim() !== `${manifest.version} (UR-Nexus)`) throw new Error(`Unexpected version: ${output}`)
  })
  await check('installed help and configuration', async () => {
    if (!requireSuccess(await run(['--help'])).includes('Usage: ur')) throw new Error('Missing CLI help')
    const config = JSON.parse(requireSuccess(await run(['config', 'list', '--json'])))
    if (!Array.isArray(config)) throw new Error('Missing configuration JSON')
  })
  await check('offline catalog registration without enabling plugins', async () => {
    const catalogs = JSON.parse(requireSuccess(await run(['plugin', 'marketplace', 'list', '--json'])))
    const bundled = catalogs.find(catalog => catalog.name === 'ur-plugins-official')
    if (bundled?.source !== 'directory' || realpathSync(bundled.path) !== realpathSync(join(installation, 'resources', 'marketplace'))) throw new Error('Installed offline catalog was not registered')
    const settingsFile = join(home, '.ur', 'settings.json')
    if (existsSync(settingsFile) && Object.values(JSON.parse(readFileSync(settingsFile, 'utf8')).enabledPlugins ?? {}).some(Boolean)) throw new Error('Catalog registration enabled a plugin automatically')
  })
  await check('real packaged resources', async () => {
    const output = requireSuccess(await run(['--ur-native-self-test']))
    const report = JSON.parse(output)
    if (!report.passed) throw new Error(JSON.stringify(report))
  })
  await check('installed subprocess supervisor without external runtime', async () => {
    const output = requireSuccess(await run(['--internal-timeout', '10s', binary, '--version']))
    if (output.trim() !== `${manifest.version} (UR-Nexus)`) throw new Error('Native subprocess did not re-enter the installed CLI')
    if ((await run(['--internal-timeout', 'invalid', binary, '--version'])).code !== 125) throw new Error('Native supervisor did not reject an invalid duration')
  })
  await check('native optional player rejects unregistered scripts', async () => {
    const marker = join(workspace, 'unregistered-player-ran')
    const candidate = join(workspace, 'unregistered-player.js')
    writeFileSync(candidate, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected execution')`)
    const result = await run(['--internal-thinkback-player', candidate])
    if (result.code === 0 || existsSync(marker)) throw new Error('Native optional player executed an unregistered script')
  })
  await check('installed agent drills and child processes', async () => {
    const report = JSON.parse(requireSuccess(await run(['selftest', 'run', '--json'])))
    if (!Array.isArray(report.automated) || report.automated.length !== 5 || report.automated.some(drill => drill.passed !== true)) {
      throw new Error(`Installed agent drills failed: ${JSON.stringify(report)}`)
    }
  })

  if (!offlineOnly) {
    const requests = []
    let createdTaskId
    const proof = join(workspace, 'release-proof.txt')
    const proofContent = 'native release write proof\n'
    const sequence = [
      ['TaskCreate', { subject: 'Verify installed native write', description: 'Write and read one temporary native smoke fixture', activeForm: 'Verifying native fixture' }],
      ['TaskUpdate', { taskId: '1', status: 'in_progress' }],
      ['Write', { file_path: proof, content: proofContent }],
      ['Read', { file_path: proof }],
      ['TaskUpdate', { taskId: '1', status: 'completed' }],
    ]
    server = createServer(async (request, response) => {
      try {
        trace(requestTrace, { event: 'received', method: request.method, url: request.url })
        if (request.headers.authorization && request.headers.authorization !== 'Bearer ur-native-smoke-no-secret') throw new Error('Unexpected authorization was sent to the native smoke endpoint')
        if (request.method === 'GET' && ['/v1/models', '/models'].includes(request.url)) {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ object: 'list', data: [{ id: 'native-smoke', object: 'model', context_length: 32768, supported_parameters: ['tools', 'max_tokens', 'temperature'] }] }))
          return
        }
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
          response.writeHead(404, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { message: `Unexpected native smoke request ${request.method} ${request.url}` } }))
          return
        }
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        trace(requestTrace, { event: 'completion', model: body.model, stream: body.stream, messageRoles: body.messages?.map(message => message.role), toolNames: body.tools?.map(tool => tool.function?.name) })
        requests.push(body)
        const toolResults = body.messages.filter(message => message.role === 'tool')
        const completed = toolResults.length
        if (completed > 0) {
          createdTaskId ??= JSON.stringify(toolResults[0].content).match(/Task #([A-Za-z0-9_-]+) created successfully/)?.[1]
          if (!createdTaskId) throw new Error('TaskCreate did not return a task ID')
        }
        const planned = sequence[completed]
        const next = planned ? [planned[0], { ...planned[1], ...(planned[0] === 'TaskUpdate' ? { taskId: createdTaskId } : {}) }] : undefined
        if (next && !body.tools?.some(tool => tool.function?.name === next[0])) throw new Error(`Expected real ${next[0]} tool in native request`)
        const message = next
          ? { role: 'assistant', content: null, tool_calls: [{ id: `native-smoke-${completed}`, type: 'function', function: { name: next[0], arguments: JSON.stringify(next[1]) } }] }
          : { role: 'assistant', content: 'Native release completed the write and read verification.' }
        const finish = next ? 'tool_calls' : 'stop'
        const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
        if (body.stream) {
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          const delta = message.tool_calls ? { ...message, tool_calls: message.tool_calls.map((call, index) => ({ ...call, index })) } : message
          response.write(`data: ${JSON.stringify({ id: 'native-smoke', object: 'chat.completion.chunk', model: 'native-smoke', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
          response.write(`data: ${JSON.stringify({ id: 'native-smoke', object: 'chat.completion.chunk', model: 'native-smoke', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage })}\n\n`)
          response.end('data: [DONE]\n\n')
        } else {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ id: 'native-smoke', object: 'chat.completion', model: 'native-smoke', choices: [{ index: 0, message, finish_reason: finish }], usage }))
        }
      } catch (error) {
        trace(requestTrace, { event: 'server-error', error: String(error) })
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: String(error), type: 'native_smoke_server' } }))
      }
    })
    await new Promise((resolveServer, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveServer) })
    const address = server.address()
    const baseURL = `http://127.0.0.1:${address.port}/v1`
    const settings = JSON.stringify({
      provider: { active: 'openai-compatible', model: 'native-smoke', baseUrls: { 'openai-compatible': baseURL } },
      sandbox: { enabled: false },
    })
    const common = ['--model', 'native-smoke', '--settings', settings, '--permission-mode', 'acceptEdits', '--max-turns', '8', '--output-format', 'json']
    if (process.platform === 'win32') {
      await check('Windows required sandbox refuses provider execution', async () => {
        const before = requests.length
        const required = JSON.stringify({
          provider: { active: 'openai-compatible', model: 'native-smoke', baseUrls: { 'openai-compatible': baseURL } },
          sandbox: { enabled: true, failIfUnavailable: true },
        })
        const result = await run(['-p', '--model', 'native-smoke', '--settings', required, '--output-format', 'json', 'This request must be refused.'])
        if (result.code === 0 || !result.stderr.includes('sandbox required but unavailable') || !result.stderr.includes('packaged helper is not configured') || requests.length !== before) {
          throw new Error(`Windows required sandbox did not fail closed: ${result.stderr}`)
        }
      })
    }
    let sessionId
    await check('native provider stream, task, write, read, and session', async () => {
      const output = requireSuccess(await run(['-p', '--debug-file', providerDebugFiles[0], ...common, 'Write release-proof.txt containing native release write proof, then read it back and verify it.']))
      const result = JSON.parse(output)
      if (result.is_error) throw new Error(result.result ?? output)
      if (!existsSync(proof) || readFileSync(proof, 'utf8') !== proofContent) throw new Error('Native Write did not create the expected proof')
      if (requests.length < 6 || !requests.some(body => body.messages.some(message => message.role === 'tool'))) throw new Error('No complete native tool loop was observed')
      if (!requests.some(body => body.stream === true)) throw new Error('Native streaming was not exercised')
      const task = JSON.parse(readFileSync(join(home, '.ur', 'tasks', 'native-release-smoke', `${createdTaskId}.json`), 'utf8'))
      if (task.status !== 'completed') throw new Error(`Native task did not complete: ${task.status}`)
      const completedResults = requests.at(-1).messages.filter(message => message.role === 'tool')
      if (!JSON.stringify(completedResults).includes('native release write proof')) throw new Error('Native Read did not return the written proof')
      sessionId = result.session_id
      if (!sessionId) throw new Error('Native session was not persisted')
    })
    await check('native session resume', async () => {
      if (!sessionId) throw new Error('First native session failed')
      const output = requireSuccess(await run(['-p', '--debug-file', providerDebugFiles[1], ...common, '--resume', sessionId, 'Confirm the prior verification.']))
      const result = JSON.parse(output)
      if (result.is_error || !requests.at(-1).messages.some(message => JSON.stringify(message.content).includes('Write release-proof.txt'))) throw new Error('Resume did not restore the prior conversation')
    })
  }
} finally {
  if (server) await new Promise(resolveServer => server.close(resolveServer))
  const failed = results.some(result => !result.passed)
  // Keep failure evidence for diagnosis; successful qualification leaves nothing behind.
  if (!failed) rmSync(temporary, { recursive: true, force: true })
  else console.error(`Native smoke evidence retained at ${temporary}`)
}

console.log(JSON.stringify({ passed: results.every(result => result.passed), platform, offlineOnly, ...(results.some(result => !result.passed) ? { evidenceDirectory: temporary, diagnostics: { commandTrace, requestTrace, providerDebugFiles: providerDebugFiles.filter(existsSync) } } : {}), results }, null, 2))
if (results.some(result => !result.passed)) process.exitCode = 1
