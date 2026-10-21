#!/usr/bin/env node
/** Test the exact packaged VSIX in a real isolated VS Code extension host. */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
const args = process.argv.slice(2)
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1] }
const code = option('--code') ?? process.env.UR_VSCODE_EXECUTABLE ?? (process.platform === 'darwin' ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : 'code')
const vsix = option('--vsix')
if (!vsix) throw new Error('Usage: node scripts/editor-host-smoke.mjs --vsix <packaged.vsix> [--code <VS Code executable>]')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temporary = mkdtempSync(join(tmpdir(), 'ur-editor-host-'))
const workspace = join(temporary, 'workspace')
const extracted = join(temporary, 'package')
const resultPath = join(temporary, 'result.json')
const trace = join(workspace, 'cli-trace.jsonl')
mkdirSync(workspace, { recursive: true })
for (const [name, bytes] of Object.entries(unzipSync(readFileSync(resolve(vsix))))) {
  const path = resolve(extracted, name)
  if (!path.startsWith(`${extracted}/`)) throw new Error('VSIX contains an escaping path')
  if (name.endsWith('/')) mkdirSync(path, { recursive: true })
  else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes) }
}
const manifest = JSON.parse(readFileSync(join(extracted, 'extension/package.json'), 'utf8'))
if (!existsSync(join(extracted, 'extension', manifest.main))) throw new Error('VSIX is missing its entry point')
writeFileSync(join(workspace, 'sample.js'), 'export function hello() { return "hello" }\n')
const fixture = join(temporary, 'cli-fixture.cjs')
writeFileSync(fixture, `const fs=require('node:fs');const readline=require('node:readline');const args=process.argv.slice(2);const trace=${JSON.stringify(trace)};fs.appendFileSync(trace,JSON.stringify(args)+'\\n');if(!args.includes('-p')){console.log(JSON.stringify({tasks:[],diffs:[]}));process.exit(0)}const input=readline.createInterface({input:process.stdin});input.on('line',line=>{const message=JSON.parse(line);if(message.type!=='user')return;const turns=fs.readFileSync(trace,'utf8').trim().split('\\n').map(JSON.parse).filter(a=>a.includes('-p')).length;const send=x=>console.log(JSON.stringify(x));send({type:'system',subtype:'init',session_id:'host-cli-session'});if(turns===3){setInterval(()=>{},1000)}else{send({type:'assistant',message:{content:[{type:'text',text:'host turn '+turns+' café العربية'}]}});send({type:'result',subtype:'success',is_error:false,result:'done'})}});`)

const settings = { 'ur.executablePath': process.execPath, 'ur.executableArgs': [fixture], 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'telemetry.telemetryLevel': 'off', 'window.restoreWindows': 'none' }
mkdirSync(join(temporary, 'user/User'), { recursive: true }); writeFileSync(join(temporary, 'user/User/settings.json'), JSON.stringify(settings))
const env = { ...process.env, UR_EDITOR_HOST_RESULT: resultPath, UR_EDITOR_HOST_TRACE: trace }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(code, [workspace, '--new-window', '--disable-extensions', '--disable-workspace-trust', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--user-data-dir', join(temporary, 'user'), '--extensions-dir', join(temporary, 'extensions'), `--extensionDevelopmentPath=${join(extracted, 'extension')}`, `--extensionTestsPath=${join(root, 'scripts/editor-host-suite.cjs')}`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', chunk => { output = (output + chunk).slice(-32000) }); child.stderr.on('data', chunk => { output = (output + chunk).slice(-32000) })
const timer = setTimeout(() => child.kill('SIGKILL'), 90_000)
let status
try { status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) }) } finally { clearTimeout(timer) }
writeFileSync(join(temporary, 'host.log'), output)
if (status !== 0 || !existsSync(resultPath)) throw new Error(`Packaged editor host test failed (${status}); evidence ${temporary}\n${output}`)
const result = JSON.parse(readFileSync(resultPath, 'utf8'))
if (!result.ok) throw new Error(`Packaged editor host assertions failed: ${JSON.stringify(result)}; evidence ${temporary}\n${output}`)
console.log(JSON.stringify({ ...result, package: resolve(vsix), version: manifest.version }))
rmSync(temporary, { recursive: true, force: true })
