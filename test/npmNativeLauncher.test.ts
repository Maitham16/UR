import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { extractNativeTarGz, parseNativeReleaseManifest } from '../bin/npm-native.mjs'

const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'ur npm launcher % [café!] ')))
const version = '9.8.7', target = `${process.platform}-${process.arch}`, commit = 'a'.repeat(40)
const nodeResult = spawnSync(process.env.NODE_BIN || 'node', ['-p', 'process.execPath'], { encoding: 'utf8' })
const node = nodeResult.stdout.trim()
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
type Entry = { name: string; bytes?: Buffer; type?: string; mode?: number; link?: string }

function archive(entries: Entry[]) {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const header = Buffer.alloc(512), bytes = entry.bytes ?? Buffer.alloc(0)
    header.write(entry.name, 0, 100)
    const number = (value: number, offset: number, length: number) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length)
    number(entry.mode ?? 0o644, 100, 8); number(0, 108, 8); number(0, 116, 8)
    number(bytes.length, 124, 12); number(0, 136, 12)
    header.fill(32, 148, 156); header.write(entry.type ?? '0', 156, 1)
    if (entry.link) header.write(entry.link, 157, 100)
    header.write('ustar\0', 257, 6); header.write('00', 263, 2)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]), { level: 1 })
}
function pax(key: string, value: Buffer) {
  const body = Buffer.concat([Buffer.from(` ${key}=`), value, Buffer.from('\n')])
  let length = body.length + 1
  while (String(length).length + body.length !== length) length = String(length).length + body.length
  return Buffer.concat([Buffer.from(String(length)), body])
}
const smallEntries: Entry[] = [{ name: 'ur', bytes: Buffer.from('native fixture'), mode: 0o755 }, { name: 'resources/manifest.json', bytes: Buffer.from('{}') }]
let nativeArchive: Buffer
beforeAll(() => {
  if (process.platform === 'win32') return
  expect(nodeResult.status, nodeResult.stderr).toBe(0)
  const source = join(temporary, 'fixture.ts'), executable = join(temporary, 'fixture-native')
  writeFileSync(source, `import {readFileSync,writeFileSync} from 'node:fs';import {dirname,join} from 'node:path';
const [mode,...args]=process.argv.slice(2);
if(mode==='--version') console.log(process.env.UR_NPM_TEST_WRONG_VERSION?'wrong':${JSON.stringify(version + ' (UR-Nexus)')});
else if(mode==='--ur-native-self-test'){if(process.env.UR_NPM_TEST_VERIFY_READY){writeFileSync(process.env.UR_NPM_TEST_VERIFY_READY,String(process.pid));setInterval(()=>{},1000);}else{const proof=readFileSync(join(dirname(process.execPath),'resources/proof.txt'),'utf8');console.log(JSON.stringify({passed:proof==='native resource proof'}));}}
else if(mode==='argv') console.log(JSON.stringify({args,root:process.env.UR_NPM_PACKAGE_ROOT,launcher:process.env.UR_NPM_LAUNCHER_PATH,node:process.env.UR_NPM_NODE_EXECUTABLE,native:process.env.UR_NPM_NATIVE_EXECUTABLE,model:process.env.OLLAMA_MODEL}));
else if(mode==='io'){process.stdout.write(readFileSync(0));process.stdout.write('O'.repeat(320000));process.stderr.write('E'.repeat(320000));}
else if(mode==='exit') process.exit(Number(args[0]));
else if(mode==='wait'){process.on('SIGTERM',()=>process.exit(23));writeFileSync(process.env.UR_NPM_TEST_READY!,'ready');setInterval(()=>{},1000);}
else if(mode==='signal') process.kill(process.pid,'SIGTERM');
else process.exit(91);
`)
  const built = spawnSync(process.execPath, ['build', '--compile', '--no-compile-autoload-bunfig', '--outfile', executable, source], { encoding: 'utf8', timeout: 60_000 })
  expect(built.status, built.stderr).toBe(0)
  nativeArchive = archive([
    { name: 'ur', bytes: readFileSync(executable), mode: 0o755 },
    { name: 'resources/manifest.json', bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, version, platform: target })) },
    { name: 'resources/proof.txt', bytes: Buffer.from('native resource proof') },
  ])
}, 90_000)
afterAll(() => rmSync(temporary, { recursive: true, force: true }))

function manifest(bytes: Buffer = Buffer.from('archive')) {
  return { schemaVersion: 1, version, sourceCommit: commit, platforms: {
    [target]: { file: `ur-${version}-${target}.tar.gz`, size: bytes.length, sha256: hash(bytes), executable: 'ur' },
  } }
}
async function fixture(bytes = nativeArchive, options: { badHash?: boolean } = {}) {
  const directory = mkdtempSync(join(temporary, 'package ')), root = join(directory, 'installed package'), home = join(directory, 'home')
  mkdirSync(join(root, 'bin'), { recursive: true }); mkdirSync(home)
  for (const file of ['ur.js', 'npm-native.mjs']) copyFileSync(join(import.meta.dir, '..', 'bin', file), join(root, 'bin', file))
  const metadata = { name: 'ur-agent', version, type: 'module', urDistribution: 'native', bin: { ur: 'bin/ur.js' } }
  writeFileSync(join(root, 'package.json'), JSON.stringify(metadata))
  const release = manifest(bytes)
  if (options.badHash) release.platforms[target]!.sha256 = 'f'.repeat(64)
  writeFileSync(join(root, 'bin', 'native-release.json'), JSON.stringify(release))
  let downloads = 0
  const server = createServer((request, response) => {
    downloads++
    if (request.url !== `/v${version}/ur-${version}-${target}.tar.gz`) { response.writeHead(404).end(); return }
    response.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': 'application/octet-stream' }); response.end(bytes)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const env = { HOME: home, XDG_CACHE_HOME: join(directory, 'cache'), PATH: '', UR_CONFIG_DIR: join(home, '.ur'),
    BUN_BIN: join(directory, 'Bun must not run'), UR_MODEL: 'fixture-model',
    UR_NPM_NATIVE_BASE_URL: `http://127.0.0.1:${address.port}`, DO_NOT_TRACK: '1', CI: '1' }
  const cache = join(env.XDG_CACHE_HOME, 'ur', 'npm', `${version}-${target}`)
  return { root, home, env, cache, downloads: () => downloads, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function launch(state: Fixture, args: string[], extra: Record<string, string> = {}, input = '', restrictiveUmask = false) {
  const launcher = join(state.root, 'bin', 'ur.js')
  const nodeArgs = restrictiveUmask ? ['--input-type=module', '-e', `process.umask(0o077);process.argv=[process.execPath,${JSON.stringify(launcher)},...process.argv.slice(1)];await import(${JSON.stringify(pathToFileURL(launcher).href)});`, '--', ...args] : [launcher, ...args]
  const child = spawn(node, nodeArgs, { env: { ...state.env, ...extra }, cwd: state.home, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', text => { stdout += text })
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text })
  child.stdin.end(input)
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
  const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }) })
  })
  return { child, result }
}

describe.skipIf(process.platform === 'win32')('npm native launcher without external Bun', () => {
  test('pins archive identity and rejects unknown/malformed platform metadata', () => {
    expect(parseNativeReleaseManifest(manifest(), version).version).toBe(version)
    for (const mutate of [
      (value: any) => value.version = '0.0.1', (value: any) => value.sourceCommit = 'invalid',
      (value: any) => value.platforms[target].file = '../escape', (value: any) => value.platforms[target].size = Infinity,
      (value: any) => value.platforms[target].executable = 'bun', (value: any) => value.platforms = { unknown: value.platforms[target] },
    ]) { const value = manifest(); mutate(value); expect(() => parseNativeReleaseManifest(value, version)).toThrow() }
  })

  test('first launch, restrictive umask, exact arguments/channel markers, and cached offline launch', async () => {
    const state = await fixture()
    try {
      const first = await launch(state, ['--version'], {}, '', true).result
      expect(first.code, first.stderr).toBe(0)
      expect(first.stdout.trim()).toBe(`${version} (UR-Nexus)`)
      expect(state.downloads()).toBe(1)
      await state.close()
      const args = ['', 'spaced café 日本語', '%VALUE% & ! []', 'embedded"quote', 'trailing\\', 'quote"slash\\\\']
      const cached = await launch(state, ['argv', ...args]).result
      expect(cached.code, cached.stderr).toBe(0)
      expect(JSON.parse(cached.stdout)).toEqual({ args, root: state.root, launcher: join(state.root, 'bin', 'ur.js'), node, native: join(state.cache, 'ur'), model: 'fixture-model' })
      expect(cached.stderr).toBe('')
      expect(existsSync(join(state.home, '.local', 'bin', 'ur'))).toBe(false)
    } finally { await state.close() }
  }, 90_000)

  test('parallel cold launches download only once and repair corrupt resources before execution', async () => {
    const state = await fixture()
    try {
      const results = await Promise.all(Array.from({ length: 3 }, () => launch(state, ['--version']).result))
      for (const result of results) expect(result.code, result.stderr).toBe(0)
      expect(state.downloads()).toBe(1)
      writeFileSync(join(state.cache, 'resources', 'proof.txt'), 'corrupt resource')
      const repaired = await launch(state, ['--version']).result
      expect(repaired.code, repaired.stderr).toBe(0)
      expect(state.downloads()).toBe(2)
      expect(readFileSync(join(state.cache, 'resources', 'proof.txt'), 'utf8')).toBe('native resource proof')
    } finally { await state.close() }
  }, 90_000)

  test('preserves large UTF-8 streams, exact child exit codes, and parent/child signal behavior', async () => {
    const state = await fixture()
    try {
      expect((await launch(state, ['--version']).result).code).toBe(0)
      const input = '日本語 café % & "quoted"\\tail\n'.repeat(16000)
      const output = await launch(state, ['io'], {}, input).result
      expect(output.code, output.stderr.slice(0, 200)).toBe(0)
      expect(output.stdout === input + 'O'.repeat(320000)).toBe(true)
      expect(output.stderr === 'E'.repeat(320000)).toBe(true)
      for (const code of [7, 124]) expect((await launch(state, ['exit', String(code)]).result).code).toBe(code)
      const ready = join(state.home, 'ready'), waiting = launch(state, ['wait'], { UR_NPM_TEST_READY: ready })
      const deadline = Date.now() + 20_000
      while (!existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
      expect(existsSync(ready)).toBe(true)
      waiting.child.kill('SIGTERM')
      expect((await waiting.result).code).toBe(23)
      expect((await launch(state, ['signal']).result).signal).toBe('SIGTERM')
    } finally { await state.close() }
  }, 90_000)

  test('rejects checksum mismatches, remote test overrides, and failed version verification without activation', async () => {
    const mismatch = await fixture(Buffer.from('bad archive'), { badHash: true })
    try {
      const result = await launch(mismatch, ['--version']).result
      expect(result.code).toBe(1); expect(result.stderr).toContain('checksum or size mismatch')
      expect(existsSync(mismatch.cache)).toBe(false)
      const remote = await launch(mismatch, ['--version'], { UR_NPM_NATIVE_BASE_URL: 'https://example.invalid' }).result
      expect(remote.code).toBe(1); expect(remote.stderr).toContain('loopback')
      expect(mismatch.downloads()).toBe(1)
    } finally { await mismatch.close() }
    const wrong = await fixture()
    try {
      const result = await launch(wrong, ['--version'], { UR_NPM_TEST_WRONG_VERSION: '1' }).result
      expect(result.code).toBe(1); expect(result.stderr).toContain('wrong version')
      expect(existsSync(wrong.cache)).toBe(false)
      expect(existsSync(wrong.cache + '.lock')).toBe(false)
    } finally { await wrong.close() }
  }, 90_000)

  test('interrupting native verification cleans up its process group, stage, and lock', async () => {
    const state = await fixture()
    try {
      const ready = join(state.home, 'verification-ready')
      const pending = launch(state, ['--version'], { UR_NPM_TEST_VERIFY_READY: ready })
      const deadline = Date.now() + 20_000
      while (!existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
      expect(existsSync(ready)).toBe(true)
      const verifierPid = Number(readFileSync(ready, 'utf8'))
      pending.child.kill('SIGTERM')
      expect((await pending.result).signal).toBe('SIGTERM')
      expect(() => process.kill(verifierPid, 0)).toThrow()
      expect(existsSync(state.cache)).toBe(false)
      expect(existsSync(state.cache + '.lock')).toBe(false)
    } finally { await state.close() }
  }, 90_000)

  test('extracts PAX Unicode paths and ignores binary BSD attributes without applying them', async () => {
    // Exercise a long PAX pathname without exceeding ext4's 255-byte limit
    // for any individual filename (APFS permits more UTF-8 bytes here).
    const path = `resources/${'日本語'.repeat(20)}/${'日本語'.repeat(20)}.txt`
    expect(Buffer.byteLength(path)).toBeGreaterThan(255)
    expect(path.split('/').every(part => Buffer.byteLength(part) <= 255)).toBe(true)
    const bytes = archive([...smallEntries, { name: 'PaxHeader', type: 'x', bytes: Buffer.concat([pax('path', Buffer.from(path)), pax('SCHILY.xattr.com.apple.provenance', Buffer.from([0xff, 0, 1]))]) }, { name: 'short', bytes: Buffer.from('unicode proof') }])
    const tar = join(temporary, 'pax.tar.gz'), destination = join(temporary, 'pax-extract')
    writeFileSync(tar, bytes)
    const files = await extractNativeTarGz(tar, destination)
    expect(files[path].sha256).toBe(hash(Buffer.from('unicode proof')))
    expect(readFileSync(join(destination, path), 'utf8')).toBe('unicode proof')
  })

  for (const entry of [
    { name: '../escape' }, { name: '/absolute' }, { name: 'resources/../../escape' },
    { name: 'resources/link', type: '2', link: '/outside' }, { name: 'resources/hardlink', type: '1', link: 'ur' },
    { name: 'resources/device', type: '3' }, { name: 'resources/CON .txt' },
  ]) test(`rejects unsafe native tar entry ${entry.name}`, async () => {
    const directory = mkdtempSync(join(temporary, 'hostile-')), tar = join(directory, 'archive.tar.gz')
    writeFileSync(tar, archive([...smallEntries, entry]))
    await expect(extractNativeTarGz(tar, join(directory, 'extract'))).rejects.toThrow()
    expect(existsSync(join(directory, 'escape'))).toBe(false)
  })
})
