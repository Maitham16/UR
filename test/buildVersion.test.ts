import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const directory = mkdtempSync(join(tmpdir(), 'ur compiled build version '))
const version = '9.8.7-fixture'
const binary = join(directory, process.platform === 'win32' ? 'version fixture.exe' : 'version fixture')
beforeAll(() => {
  const fixture = join(directory, 'fixture.ts')
  writeFileSync(fixture, `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBuildVersion } from ${JSON.stringify(resolve(import.meta.dir, '../src/utils/buildVersion.ts'))};
import { setOriginalCwd, setCwdState, setAllowedSettingSources } from ${JSON.stringify(resolve(import.meta.dir, '../src/bootstrap/state.ts'))};
import { recordTranscript, flushSessionStorage, setSessionFileForTesting } from ${JSON.stringify(resolve(import.meta.dir, '../src/utils/sessionStorage.ts'))};
setOriginalCwd(process.cwd()); setCwdState(process.cwd()); setAllowedSettingSources([]);
const transcript = join(process.cwd(), 'version-transcript.jsonl');
setSessionFileForTesting(transcript);
await recordTranscript([{type:'user',uuid:'11111111-1111-4111-8111-111111111111',timestamp:new Date().toISOString(),origin:{kind:'human'},message:{role:'user',content:'Record compiled version proof'}}]);
await flushSessionStorage();
const entry = readFileSync(transcript, 'utf8').trim().split('\\n').map(line=>JSON.parse(line)).find(item=>item.type==='user');
console.log(JSON.stringify({version:getBuildVersion(),macroObject:typeof MACRO,transcriptVersion:entry?.version}));
`)
  const built = spawnSync(process.execPath, [
    'build', fixture, '--compile', '--define', `MACRO.VERSION=${JSON.stringify(version)}`,
    '--external', 'sharp', '--external', 'audio-capture-napi', '--external', 'playwright-core',
    '--outfile', binary,
  ], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, NODE_ENV: 'production' } })
  if (built.status !== 0) throw new Error(`Version fixture compilation failed: ${built.stderr}`)
}, 130_000)
afterAll(() => rmSync(directory, { recursive: true, force: true }))

test('dotted version define reaches compiled transcript metadata without a runtime MACRO object', () => {
  const result = spawnSync(binary, [], {
    cwd: directory,
    env: { PATH: '', HOME: directory, USERPROFILE: directory, UR_CONFIG_DIR: join(directory, 'config'), NODE_ENV: 'production', TEST_ENABLE_SESSION_PERSISTENCE: '1', UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1' },
    encoding: 'utf8', timeout: 30_000,
  })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ version, macroObject: 'undefined', transcriptVersion: version })
})

test('an absent build version reports an honest fallback', () => {
  const entry = join(directory, 'fallback.ts')
  const output = join(directory, 'fallback.mjs')
  writeFileSync(entry, `import { getBuildVersion } from ${JSON.stringify(resolve(import.meta.dir, '../src/utils/buildVersion.ts'))}; console.log(JSON.stringify([getBuildVersion(),getBuildVersion('source')]));`)
  const built = spawnSync(process.execPath, ['build', entry, '--target', 'node', '--format', 'esm', '--define', 'MACRO.VERSION=undefined', '--outfile', output], { encoding: 'utf8', timeout: 30_000 })
  expect(built.status, built.stderr).toBe(0)
  const source = readFileSync(output, 'utf8')
  // Run the plain JS in Bun without loading the checkout's bunfig defines.
  const result = spawnSync(process.execPath, [output], { cwd: directory, encoding: 'utf8', timeout: 30_000 })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual(['unknown', 'source'])
  expect(source).not.toContain('typeof MACRO')
})
