import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getSandboxReadiness, runSafetyAudit, writeSandboxedPreset } from '../src/services/safety/safetyReadiness.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import { call } from '../src/commands/safety/safety.js'
import { listEvidence } from '../src/security/evidenceLedger.js'

const dirs: string[] = []
function temp() { const dir = mkdtempSync(join(tmpdir(), 'ur-safety-readiness-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const root = resolve(import.meta.dir, '..')

test('opt-in preset stores names, not secret values, without altering permission or project settings', () => {
  const cwd = temp()
  mkdirSync(join(cwd, '.ur'))
  const existing = '{"permissions":{"defaultMode":"autoApprove","allow":["Bash(*)"]}}\n'
  writeFileSync(join(cwd, '.ur/settings.json'), existing)
  const result = writeSandboxedPreset(cwd, { domains: ['EXAMPLE.com', 'example.com'], home: join(cwd, 'private-home'),
    env: { API_TOKEN: 'never-store-this-value', NORMAL: 'benign' } })
  const serialized = readFileSync(result.path, 'utf8')
  expect(serialized).not.toContain('never-store-this-value')
  expect(result.credentialNames).toEqual(['API_TOKEN'])
  expect(result.settings).not.toHaveProperty('permissions')
  expect(JSON.parse(serialized).sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
    network: { strictAllowlist: true, allowedDomains: ['example.com'] }, credentials: { envVars: [{ name: 'API_TOKEN', mode: 'deny' }] } })
  expect(readFileSync(join(cwd, '.ur/settings.json'), 'utf8')).toBe(existing)
  expect(() => writeSandboxedPreset(cwd)).toThrow()
  expect(readFileSync(result.path, 'utf8')).toBe(serialized)
})

test('preset rejects wildcard/URL/port domains and out-of-workspace .ur symlink writes', () => {
  const cwd = temp(), outside = temp()
  for (const domain of ['*.example.com', 'https://example.com', 'example.com:443', 'example.com/path', 'a\nb']) {
    expect(() => writeSandboxedPreset(cwd, { domains: [domain] })).toThrow('hostname')
  }
  symlinkSync(outside, join(cwd, '.ur'), 'dir')
  expect(() => writeSandboxedPreset(cwd)).toThrow('inside the workspace')
  expect(existsSync(join(outside, 'sandboxed.settings.json'))).toBe(false)
})

test('availability never claims confinement, and unsupported requested enforcement remains unavailable', () => {
  const manager = { isSandboxEnabledInSettings: () => true, isSupportedPlatform: () => false,
    checkDependencies: () => ({ errors: ['helper unavailable'], warnings: [] }),
    isSandboxingEnabled: () => false, isSandboxRequired: () => true,
    areUnsandboxedCommandsAllowed: () => false, getSandboxUnavailableReason: () => 'unsupported' }
  expect(getSandboxReadiness(manager as never)).toMatchObject({ status: 'unavailable', required: true, available: false,
    attestation: 'configuration-and-dependencies-only', reason: 'unsupported' })
  expect(getSandboxReadiness({ ...manager, isSandboxEnabledInSettings: () => false } as never).status).toBe('disabled')
})

test('offline attack and benign fixtures expose detection outcomes without claiming model/OS security', async () => {
  const cwd = temp(), before = listEvidence().length, audit = runSafetyAudit(cwd)
  expect(listEvidence()).toHaveLength(before)
  expect(audit.ok).toBe(true)
  expect(audit.injection).toMatchObject({ attacks: 8, detected: 8, benign: 4, falsePositives: 0 })
  expect(audit.injection.cases.every(item => item.preserved)).toBe(true)
  expect(audit.limits.join(' ')).toContain('do not measure model compliance')
  expect(existsSync(join(cwd, '.ur'))).toBe(false)
  const result = await runWithCwdOverride(cwd, () => call('audit --json', {} as never))
  expect(result.type).toBe('text')
  if (result.type === 'text') expect(JSON.parse(result.value).kind).toBe('offline-regression')
})

test('generated flag preset reaches actual runtime config; project-local security controls remain ignored', () => {
  const cwd = temp(), home = temp()
  const preset = writeSandboxedPreset(cwd, { env: { UR_AUDIT_TOKEN: 'fake-only' }, domains: ['fixture.invalid'], home })
  const script = join(cwd, 'config.ts')
  writeFileSync(script, `
import {setFlagSettingsPath} from ${JSON.stringify(pathToFileURL(join(root, 'src/bootstrap/state.ts')).href)}
import {getInitialSettings} from ${JSON.stringify(pathToFileURL(join(root, 'src/utils/settings/settings.ts')).href)}
import {convertToSandboxRuntimeConfig} from ${JSON.stringify(pathToFileURL(join(root, 'src/utils/sandbox/sandbox-adapter.ts')).href)}
setFlagSettingsPath(process.argv[2]);const config=convertToSandboxRuntimeConfig(getInitialSettings());
process.stdout.write(JSON.stringify({network:config.network,credentials:config.credentials,filesystem:config.filesystem}))
`)
  const child = spawnSync(process.execPath, ['run', '--preload', join(root, 'plugins/bunBundleDev.ts'), script, preset.path], {
    cwd, encoding: 'utf8', timeout: 20_000, env: { ...process.env, HOME: home, UR_CONFIG_DIR: home },
  })
  expect(child.status, child.stderr).toBe(0)
  const config = JSON.parse(child.stdout)
  expect(config.network.strictAllowlist).toBe(true)
  expect(config.credentials.envVars).toContainEqual({ name: 'UR_AUDIT_TOKEN', mode: 'deny' })
  expect(config.filesystem.denyRead).toContain(join(home, '.ssh'))
  // Loading the same file as repository configuration must not enable the
  // trusted-only credential or strict-egress controls.
  writeFileSync(join(cwd, '.ur/settings.json'), readFileSync(preset.path))
  const local = spawnSync(process.execPath, ['run', '--preload', join(root, 'plugins/bunBundleDev.ts'), script], {
    cwd, encoding: 'utf8', timeout: 20_000, env: { ...process.env, HOME: home, UR_CONFIG_DIR: home },
  })
  expect(local.status, local.stderr).toBe(0)
  const untrusted = JSON.parse(local.stdout)
  expect(untrusted.network.strictAllowlist).toBe(false)
  expect(untrusted.credentials).toBeUndefined()
})

test.skipIf(process.platform === 'win32')('actual sandbox subprocess qualifies benign work and hostile effects, or reports enforcement unavailable', () => {
  const cwd = temp(), home = temp(), outside = temp()
  const preset = writeSandboxedPreset(cwd, { env: { UR_AUDIT_TOKEN: 'fake-only' }, home, domains: ['127.0.0.1'] })
  writeFileSync(join(cwd, '.env'), 'FAKE_PRIVATE_MARKER')
  const script = join(cwd, 'probe.ts')
  writeFileSync(script, `
import {execFile} from 'node:child_process';import{readFileSync,existsSync}from'node:fs';import{join}from'node:path';
import {setFlagSettingsPath} from ${JSON.stringify(pathToFileURL(join(root, 'src/bootstrap/state.ts')).href)};
import {SandboxManager} from ${JSON.stringify(pathToFileURL(join(root, 'src/utils/sandbox/sandbox-adapter.ts')).href)};
setFlagSettingsPath(process.argv[2]);const outside=process.argv[3];let result;let server;
try{
 if(!SandboxManager.isSandboxingEnabled())result={available:false,reason:SandboxManager.getSandboxUnavailableReason()??'unsupported or missing dependencies'};
 else{
 await SandboxManager.initialize(async()=>false);
 const run=async(command)=>{const wrapped=await SandboxManager.wrapWithSandbox(command,'/bin/bash');return await new Promise(resolve=>execFile('/bin/bash',['-c',wrapped],{encoding:'utf8',timeout:6000,env:{PATH:process.env.PATH,HOME:process.env.HOME,UR_AUDIT_TOKEN:'FAKE_ONLY'}},(error,out,err)=>resolve({code:error?(typeof error.code==='number'?error.code:null):0,out,err})))};
 const benign=await run('printf ok > benign.txt');
 if(benign.code!==0&&/Operation not permitted|sandbox_init.*failed/i.test(benign.err))result={available:false,reason:benign.err.slice(0,300)};
 else{
 const secret=await run('cat .env');const escape=await run('printf nope > '+JSON.stringify(join(outside,'escape')));
 const credential=await run('test -z "\u0024{UR_AUDIT_TOKEN+x}"');
 let hits=0;server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){hits++;return new Response('LOCAL_PROBE')}});
 // The runtime deliberately sets NO_PROXY for loopback/private hosts. This
 // local fixture must exercise the authenticated egress proxy explicitly.
 const allowed=await run('curl --noproxy "" -fsS --connect-timeout 2 --max-time 3 http://127.0.0.1:'+server.port+'/');const acceptedHits=hits;
 const blocked=await run('curl --noproxy "" -fsS --connect-timeout 2 --max-time 3 http://localhost:'+server.port+'/');
 result={available:true,benign:benign.code===0&&readFileSync('benign.txt','utf8')==='ok',privateRead:secret.code!==0&&!secret.out.includes('FAKE_PRIVATE_MARKER'),outsideWrite:escape.code!==0&&!existsSync(join(outside,'escape')),credential:credential.code===0,allowedEgress:allowed.code===0&&allowed.out==='LOCAL_PROBE'&&acceptedHits===1,blockedEgress:blocked.code!==0&&hits===acceptedHits,networkEvidence:{allowed,blocked,acceptedHits,hits}};
 }
 }
}catch(error){result={available:false,reason:String(error).slice(0,300)}}finally{server?.stop(true);await SandboxManager.reset()};
process.stdout.write('UR_SANDBOX_PROBE '+JSON.stringify(result)+'\\n');
`)
  const child = spawnSync(process.execPath, ['run', '--preload', join(root, 'plugins/bunBundleDev.ts'), script, preset.path, outside], {
    cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: home, UR_CONFIG_DIR: home, USER: 'ur-fixture', LOGNAME: 'ur-fixture', TMPDIR: tmpdir() },
  })
  expect(child.status, child.stderr).toBe(0)
  const line = child.stdout.split('\n').find(line => line.startsWith('UR_SANDBOX_PROBE '))
  expect(line).toBeDefined()
  const result = JSON.parse(line!.slice('UR_SANDBOX_PROBE '.length))
  if (result.available) expect(result, JSON.stringify(result.networkEvidence)).toMatchObject({ benign: true, privateRead: true, outsideWrite: true, credential: true,
    allowedEgress: true, blockedEgress: true })
  else {
    expect(result.reason).toBeTruthy()
    console.info(`Sandbox enforcement qualification unavailable: ${result.reason}`)
    if (process.env.UR_REQUIRE_SANDBOX_PROBE === '1') expect(result.available).toBe(true)
  }
}, 60_000)
