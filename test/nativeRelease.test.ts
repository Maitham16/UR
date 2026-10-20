import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, readlink, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { activateNativeRelease, cleanupNativeInstallation, fetchNativeVersion, getNativeInstallDirectories, installNativeRelease, nativeAssetUrl, parseNativeManifest, retryWindowsFileOperation, validateArchiveEntry, validateNativeVersion } from '../src/utils/nativeRelease.js'

const temporary: string[] = []
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }) })
async function directory() { const path = await mkdtemp(join(tmpdir(), 'ur-native-release-test-')); temporary.push(path); return path }
async function withEnvironment(values: Record<string, string>, action: () => unknown | Promise<unknown>) {
  const original = new Map(Object.keys(values).map(key => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(values)) process.env[key] = value
    await action()
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('release metadata rejects traversal, malformed versions, wrong versions and untrusted artifact names', () => {
  for (const value of ['../1.2.3','1.2','v1.2.3','01.2.3','1.2.3/ur','1.2.3\n']) expect(() => validateNativeVersion(value)).toThrow()
  expect(validateNativeVersion('1.86.0-rc.1')).toBe('1.86.0-rc.1')
  expect(() => nativeAssetUrl('1.86.0','../ur.tar.gz')).toThrow()
  const artifact = { file: 'ur-1.86.0-linux-x64.tar.gz', executable: 'ur', sha256: 'a'.repeat(64), size: 10 }
  const valid = { schemaVersion: 1, version: '1.86.0', sourceCommit:'a'.repeat(40), platforms: { 'linux-x64': artifact } }
  expect(parseNativeManifest(valid,'1.86.0').version).toBe('1.86.0')
  expect(() => parseNativeManifest(valid,'1.86.1')).toThrow()
  for (const replacement of [{...artifact,file:'https://attacker.invalid/ur'},{...artifact,sha256:'bad'},{...artifact,size:Infinity},{...artifact,size:-1}]) expect(() => parseNativeManifest({...valid,platforms:{'linux-x64':replacement}},'1.86.0')).toThrow()
  for (const entry of [
    '../ur','resources/../../outside','/ur','resources/../ur','C:\\ur','resources//bad','resources/./bad','node_modules/a','resources\\..\\outside',
    'resources/manifest.json:stream','resources/NUL','resources/con.txt','resources/COM1.json','resources/LPT¹.dat',
    'resources/CON .txt','resources/CONOUT$','resources/file.','resources/file ','resources/a\u0001b','resources/a?b','resources/a|b',
  ]) expect(() => validateArchiveEntry(entry)).toThrow()
  for (const entry of ['resources/plugins/core/README.md','resources/café [docs]/100% coverage.md','resources/CONNECTION.md','resources/COM10.json']) expect(validateArchiveEntry(entry)).toBe(entry)
})

test('Windows transient filesystem locks retry within a bounded deadline; other failures do not retry', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']) {
    let attempts = 0, elapsed = 0
    const failure = Object.assign(new Error('temporary Windows lock'), { code })
    const result = await retryWindowsFileOperation(async () => {
      if (++attempts < 3) throw failure
      return 'activated'
    }, true, { timeoutMs: 500, now: () => elapsed, wait: async milliseconds => { elapsed += milliseconds } })
    expect(result).toBe('activated')
    expect(attempts).toBe(3)
    expect(elapsed).toBe(150)
  }
  let attempts = 0, elapsed = 0
  const locked = Object.assign(new Error('persistent Windows lock'), { code: 'EPERM' })
  await expect(retryWindowsFileOperation(async () => { attempts++; throw locked }, true, {
    timeoutMs: 120, now: () => elapsed, wait: async milliseconds => { elapsed += milliseconds },
  })).rejects.toBe(locked)
  expect(attempts).toBe(3)
  expect(elapsed).toBe(120)
  for (const [windows, code] of [[false, 'EPERM'], [true, 'ENOENT'], [true, 'EIO']] as const) {
    let count = 0
    const error = Object.assign(new Error('not retryable'), { code })
    await expect(retryWindowsFileOperation(async () => { count++; throw error }, windows, {
      wait: async () => { throw new Error('Unexpected retry') },
    })).rejects.toBe(error)
    expect(count).toBe(1)
  }
})

test('managed install directories require absolute paths and explicit options override launcher environment', async () => {
  const root = await directory(), binDir = join(root, 'explicit bin'), dataDir = join(root, 'explicit data')
  await withEnvironment({ UR_NATIVE_BIN_DIR: 'relative-bin', UR_NATIVE_DATA_DIR: 'relative-data' }, () => {
    expect(() => getNativeInstallDirectories()).toThrow('absolute')
    expect(getNativeInstallDirectories({ binDir, dataDir })).toEqual({ binDir, dataDir })
  })
  for (const value of ['relative', `${root}\ninvalid`, `${root}\0invalid`, `${root}"invalid`]) {
    expect(() => getNativeInstallDirectories({ binDir: value, dataDir })).toThrow('absolute')
  }
})

test('failed staging cleanup still releases the installation lock and preserves the active launcher', async () => {
  const root = await directory(), staging = join(root, 'staging'), lock = join(root, '.install-lock'), launcher = join(root, 'ur.cmd')
  await mkdir(staging); await writeFile(join(staging, 'locked-file'), 'cleanup fixture')
  await mkdir(lock); await writeFile(join(lock, 'owner.pid'), `${process.pid}\n`)
  await writeFile(launcher, 'previous launcher')
  let elapsed = 0
  const attempted: string[] = []
  const failure = Object.assign(new Error('staging locked beyond deadline'), { code: 'EPERM' })
  await expect(cleanupNativeInstallation(staging, lock, true, {
    timeoutMs: 100, now: () => elapsed, wait: async milliseconds => { elapsed += milliseconds },
    remove: async path => {
      attempted.push(path)
      if (path === staging) throw failure
      await rm(path, { recursive: true, force: true })
    },
  })).rejects.toBe(failure)
  expect(attempted.at(-1)).toBe(lock)
  expect((await readdir(root)).includes('.install-lock')).toBe(false)
  expect(await readFile(launcher, 'utf8')).toBe('previous launcher')
  expect(await readFile(join(staging, 'locked-file'), 'utf8')).toBe('cleanup fixture')
})

test('stable release check rejects prerelease/draft and malformed remote version', async () => {
  for (const body of [{tag_name:'v../x'}, {tag_name:'v1.86.0',draft:true}, {tag_name:'v1.86.0-rc.1',prerelease:true}]) {
    const request = (async () => Response.json(body)) as unknown as typeof fetch
    await expect(fetchNativeVersion('stable',request)).rejects.toThrow()
  }
})

test('Windows launcher activates different equal-size executables without overwriting version resources', async () => {
  const root = await directory()
  const old = join(root,'version1','ur.exe'), next = join(root,'version2','ur.exe'), launcher = join(root,'bin','ur.cmd')
  await mkdir(join(root,'version1')); await mkdir(join(root,'version2'))
  await writeFile(old,'old!'); await writeFile(next,'new!')
  await activateNativeRelease(old,launcher,true)
  await activateNativeRelease(next,launcher,true)
  expect(await readFile(launcher,'utf8')).toContain(next)
  expect(await readFile(old,'utf8')).toBe('old!')
  expect(await readFile(next,'utf8')).toBe('new!')
})

test('failed activation preserves previous launcher and removes temporary files', async () => {
  const root = await directory()
  const launcher = join(root,'ur')
  await mkdir(launcher); await writeFile(join(launcher,'preserved'),'old')
  await expect(activateNativeRelease(join(root,'missing'),launcher,false)).rejects.toThrow()
  expect(await readFile(join(launcher,'preserved'),'utf8')).toBe('old')
  expect((await readdir(root)).filter(name => name.includes('.tmp.'))).toEqual([])
})

test.skipIf(process.platform === 'win32')('Unix launcher changes atomically and points at immutable release executable', async () => {
  const root = await directory(), launcher = join(root,'ur')
  await activateNativeRelease(join(root,'old','ur'),launcher,false)
  await activateNativeRelease(join(root,'new','ur'),launcher,false)
  expect(await readlink(launcher)).toBe(join(root,'new','ur'))
  expect((await readdir(root)).filter(name => name.includes('.tmp.'))).toEqual([])
})

test.skipIf(process.platform === 'win32')('verified release installs resources; checksum/activation failures preserve the old installation', async () => {
  const root = await directory(), fixture = join(root,'fixture')
  await mkdir(join(fixture,'resources'),{recursive:true})
  await writeFile(join(fixture,'ur'),'fixture executable')
  await writeFile(join(fixture,'resources','manifest.json'),'{}')
  const archive = join(root,'fixture.tar.gz')
  execFileSync('tar',['-czf',archive,'-C',fixture,'ur','resources'])
  const bytes = await readFile(archive)
  const version = '1.86.0', file = `ur-${version}-darwin-arm64.tar.gz`
  const artifact = { file, executable:'ur', size:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') }
  let corrupt = false
  const request = (async (input: string | URL | Request) => String(input).endsWith('manifest.json')
    ? Response.json({schemaVersion:1,version,sourceCommit:'a'.repeat(40),platforms:{'darwin-arm64':artifact}})
    : new Response(corrupt ? 'bad bytes' : bytes)) as unknown as typeof fetch
  const options = { dataDir:join(root,'data'),binDir:join(root,'bin'),platform:'darwin-arm64' as const,request, verify:()=>{} }
  const installed = await installNativeRelease(version,options)
  expect(installed.wasUpdated).toBe(true)
  const target = await readlink(join(root,'bin','ur'))
  expect(await readFile(join(target,'..','resources','manifest.json'),'utf8')).toBe('{}')
  corrupt = true
  await expect(installNativeRelease(version,{...options,force:true})).rejects.toThrow()
  expect(await readlink(join(root,'bin','ur'))).toBe(target)
  expect((await readdir(join(root,'data','versions'))).filter(name=>name.startsWith('.'))).toEqual([])
  const lock = join(root,'data','versions','.install-lock')
  await mkdir(lock); await writeFile(join(lock,'owner.pid'),`${process.pid}\n`)
  await expect(installNativeRelease(version,options)).rejects.toThrow('Another native installation is active')
  expect(await readFile(join(lock,'owner.pid'),'utf8')).toBe(`${process.pid}\n`)
  expect(await readlink(join(root,'bin','ur'))).toBe(target)
})

test.skipIf(process.platform === 'win32')('shell bootstrap installs and repeats safely without npm or Bun', async () => {
  const root = await directory(), fixture = join(root,'fixture'), commands = join(root,'commands'), home = join(root,'home café $ literal!')
  await mkdir(join(fixture,'resources'),{recursive:true}); await mkdir(commands); await mkdir(home)
  const version = '1.86.0', platform = `${process.platform}-${process.arch}`, file = `ur-${version}-${platform}.tar.gz`
  await writeFile(join(fixture,'ur'),'#!/bin/sh\ncase "$1" in --version) echo "1.86.0 (UR-Nexus)";; --ur-native-self-test) echo \'{"passed":true}\';; esac\n')
  await chmod(join(fixture,'ur'),0o755)
  await writeFile(join(fixture,'resources','manifest.json'),'{}')
  const archive = join(root,file)
  execFileSync('tar',['-czf',archive,'-C',fixture,'ur','resources'])
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
  await writeFile(join(root,'SHA256SUMS'),`${digest}  ${file}\n`)
  await writeFile(join(commands,'curl'),'#!/bin/sh\nset -eu\noutput=\nurl=\nwhile [ "$#" -gt 0 ]; do case "$1" in -o) output=$2; shift 2;; https:*) url=$1; shift;; *) shift;; esac; done\nprintf "%s\\n" "$url" >> "$UR_BOOTSTRAP_FIXTURE/downloads.log"\ncp "$UR_BOOTSTRAP_FIXTURE/${url##*/}" "$output"\n')
  await chmod(join(commands,'curl'),0o755)
  const env = {...process.env,HOME:home,XDG_DATA_HOME:join(home,'data'),PATH:`${commands}:/usr/bin:/bin`,UR_BOOTSTRAP_FIXTURE:root}
  const script = join(import.meta.dir,'..','install.sh')
  for (let attempt=0;attempt<2;attempt++) execFileSync('/bin/sh',[script,version],{env,stdio:'pipe'})
  expect(await readlink(join(home,'.local','bin','ur'))).toBe(join(home,'data','ur','versions',`${version}-${platform}`,'ur'))
  expect(await readdir(join(home,'data','ur','versions'))).toEqual([`${version}-${platform}`])
  expect((await readFile(join(root,'downloads.log'),'utf8')).trim().split('\n')).toHaveLength(2)
})

test('Windows ZIP install keeps resources with the executable and rejects traversal before extraction', async () => {
  const root = await directory(), version = '1.86.0', file = `ur-${version}-win32-x64.zip`
  let bytes = zipSync({'ur.exe':new TextEncoder().encode('native fixture'),'resources/manifest.json':new TextEncoder().encode('{}')})
  const request = (async (input: string | URL | Request) => String(input).endsWith('manifest.json')
    ? Response.json({schemaVersion:1,version,sourceCommit:'a'.repeat(40),platforms:{'win32-x64':{file,executable:'ur.exe',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}})
    : new Response(bytes)) as unknown as typeof fetch
  const options = {dataDir:join(root,'data'),binDir:join(root,'bin'),platform:'win32-x64' as const,request,verify:()=>{}}
  await installNativeRelease(version,options)
  const executable = join(root,'data','versions',`${version}-win32-x64`,'ur.exe')
  const initialLauncher = await readFile(join(root,'bin','ur.cmd'),'utf8')
  expect(initialLauncher).toContain(executable)
  expect(initialLauncher).toContain(`@set "UR_NATIVE_BIN_DIR=${options.binDir}"`)
  expect(initialLauncher).toContain(`@set "UR_NATIVE_DATA_DIR=${options.dataDir}"`)
  expect(await readFile(join(executable,'..','resources','manifest.json'),'utf8')).toBe('{}')
  await installNativeRelease(version,{...options,force:true})
  const repairedLauncher = await readFile(join(root,'bin','ur.cmd'),'utf8')
  expect(repairedLauncher).toContain('-repair-')
  const noNetwork = (async () => { throw new Error('Cached repair must not download again') }) as unknown as typeof fetch
  const reused = await installNativeRelease(version,{...options,request:noNetwork})
  expect(reused.wasUpdated).toBe(false)
  expect(await readFile(join(root,'bin','ur.cmd'),'utf8')).toBe(repairedLauncher)
  for (const invalid of ['resources/../../escaped', 'resources/manifest.json:stream', 'resources/NUL.txt', 'resources/file.']) {
    bytes = zipSync({'ur.exe':new TextEncoder().encode('native fixture'),[invalid]:new Uint8Array([1])})
    await expect(installNativeRelease(version,{...options,force:true})).rejects.toThrow('Unsafe native archive entry')
    expect(await readFile(join(root,'bin','ur.cmd'),'utf8')).toBe(repairedLauncher)
  }
})

test('custom launcher directories survive repeat, upgrade and offline rollback without changing XDG or user data', async () => {
  const root = await directory(), config = join(root,'private home','.ur')
  const binDir = join(root, 'custom [café!] 100% bin'), dataDir = join(root, 'custom [café!] 100% data'), defaultData = join(root, 'unused XDG data')
  await mkdir(join(config,'projects'),{recursive:true})
  const settings = '{"provider":{"active":"ollama"},"customSetting":"preserve"}\n'
  const session = '{"type":"user","message":"prior session fixture"}\n'
  await writeFile(join(config,'settings.json'),settings)
  await writeFile(join(config,'projects','prior-session.jsonl'),session)
  const downloads: string[] = []
  let offline = false
  const archives = new Map<string,Uint8Array>()
  for (const version of ['1.86.0','1.86.1']) archives.set(version,zipSync({'ur.exe':new TextEncoder().encode(`native fixture ${version}`),'resources/manifest.json':new TextEncoder().encode(JSON.stringify({version}))}))
  const request = (async (input: string | URL | Request) => {
    if (offline) throw new Error('Network disabled for retained release rollback')
    const url = String(input), version = url.match(/\/v(1\.86\.[01])\//)?.[1]
    if (!version) throw new Error('Unexpected upgrade endpoint')
    const bytes = archives.get(version)!
    if (url.endsWith('manifest.json')) return Response.json({schemaVersion:1,version,sourceCommit:'a'.repeat(40),platforms:{'win32-x64':{file:`ur-${version}-win32-x64.zip`,executable:'ur.exe',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}})
    downloads.push(version)
    return new Response(Buffer.from(bytes))
  }) as unknown as typeof fetch
  const options = {platform:'win32-x64' as const,request,verify:()=>{}}
  await withEnvironment({ UR_NATIVE_BIN_DIR: binDir, UR_NATIVE_DATA_DIR: dataDir, HOME: join(root, 'private home'), XDG_DATA_HOME: defaultData }, async () => {
    expect(getNativeInstallDirectories()).toEqual({ binDir, dataDir })
    await installNativeRelease('1.86.0',options)
    expect((await installNativeRelease('1.86.0',options)).wasUpdated).toBe(false)
    await installNativeRelease('1.86.1',options)
    expect(await readFile(join(binDir,'ur.cmd'),'utf8')).toContain('1.86.1-win32-x64')
    offline = true
    const rollback = await installNativeRelease('1.86.0',options)
    expect(rollback.wasUpdated).toBe(true)
    const launcher = await readFile(join(binDir,'ur.cmd'),'utf8')
    expect(launcher).toContain('1.86.0-win32-x64')
    expect(launcher).toContain(`@set "UR_NATIVE_BIN_DIR=${binDir.replace(/%/g, '%%')}"`)
    expect(launcher).toContain(`@set "UR_NATIVE_DATA_DIR=${dataDir.replace(/%/g, '%%')}"`)
    expect(downloads).toEqual(['1.86.0','1.86.1'])
    expect(process.env.XDG_DATA_HOME).toBe(defaultData)
    await expect(readFile(join(defaultData, 'ur', 'versions'))).rejects.toThrow()
    await expect(readFile(join(root, 'private home', '.local', 'bin', 'ur.cmd'))).rejects.toThrow()
    expect(await readFile(join(config,'settings.json'),'utf8')).toBe(settings)
    expect(await readFile(join(config,'projects','prior-session.jsonl'),'utf8')).toBe(session)
    expect((await readdir(join(dataDir,'versions'))).sort()).toEqual(['1.86.0-win32-x64','1.86.1-win32-x64'])
  })
})
