import { afterAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call } from '../src/commands/sdk/sdk.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

const directory = mkdtempSync(join(tmpdir(), 'ur headless example '))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

test('generated TypeScript example imports the real public SDK and drives an installed executable', async () => {
  await runWithCwdOverride(directory, () => call('init --json', {} as never))
  const buildSdk = spawnSync('node', ['scripts/build-sdk.mjs'], { encoding: 'utf8' })
  expect(buildSdk.status, buildSdk.stderr).toBe(0)
  const packageDir = join(directory, 'node_modules', 'ur-agent')
  mkdirSync(packageDir, { recursive: true })
  cpSync(join(process.cwd(), 'sdk'), join(packageDir, 'sdk'), { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'ur-agent', type: 'module', exports: { './sdk': './sdk/index.js' } }))
  const example = join(directory, '.ur', 'sdk', 'example.ts')
  const trace = join(directory, 'arguments.json')
  const fixture = join(directory, 'fixture.ts')
  const executable = join(directory, process.platform === 'win32' ? 'installed UR.exe' : 'installed UR')
  writeFileSync(fixture, `import { writeFileSync } from 'node:fs'; import { createInterface } from 'node:readline'; const input=createInterface({input:process.stdin}); input.on('line',line=>{const message=JSON.parse(line);if(message.type==='user'){writeFileSync(process.env.UR_EXAMPLE_TRACE!,JSON.stringify({args:process.argv.slice(2),prompt:message.message.content}));console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'headless example proof'}));}});`)
  const build = spawnSync(process.execPath, ['build', fixture, '--compile', '--outfile', executable], { encoding: 'utf8', timeout: 60_000 })
  expect(build.status, build.stderr).toBe(0)
  const result = spawnSync(process.execPath, [example], {
    cwd: directory,
    env: { ...process.env, UR_MODEL: 'example-fixture-model', UR_EXECUTABLE: executable, UR_EXAMPLE_TRACE: trace },
    encoding: 'utf8', timeout: 30_000,
  })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe('headless example proof')
  expect(JSON.parse(readFileSync(trace, 'utf8'))).toEqual({
    args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio',
      '--model', 'example-fixture-model', '--max-turns', '4'],
    prompt: 'Summarize the README in one sentence',
  })
  const repeated = await runWithCwdOverride(directory, () => call('init --json', {} as never))
  expect(repeated.type).toBe('text')
  if (repeated.type !== 'text') throw new Error('Expected scaffold report')
  expect(JSON.parse(repeated.value).skipped).toContain('example.ts')
}, 90_000)
