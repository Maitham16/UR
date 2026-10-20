import { afterAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call } from '../src/commands/sdk/sdk.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

const directory = mkdtempSync(join(tmpdir(), 'ur headless example '))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

test('generated TypeScript example drives an installed executable without a nonexistent SDK package', async () => {
  await runWithCwdOverride(directory, () => call('init --json', {} as never))
  const example = join(directory, '.ur', 'sdk', 'example.ts')
  const trace = join(directory, 'arguments.json')
  const fixture = join(directory, 'fixture.ts')
  const executable = join(directory, process.platform === 'win32' ? 'installed UR.exe' : 'installed UR')
  writeFileSync(fixture, `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.UR_EXAMPLE_TRACE!, JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({ result: 'headless example proof' }));`)
  const build = spawnSync(process.execPath, ['build', fixture, '--compile', '--outfile', executable], { encoding: 'utf8', timeout: 60_000 })
  expect(build.status, build.stderr).toBe(0)
  const result = spawnSync(process.execPath, [example], {
    cwd: directory,
    env: { ...process.env, UR_MODEL: 'example-fixture-model', UR_EXECUTABLE: executable, UR_EXAMPLE_TRACE: trace },
    encoding: 'utf8', timeout: 30_000,
  })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe('headless example proof')
  expect(JSON.parse(readFileSync(trace, 'utf8'))).toEqual([
    '-p', '--model', 'example-fixture-model', '--max-turns', '4', '--output-format', 'json',
    'Summarize the README in one sentence',
  ])
  const repeated = await runWithCwdOverride(directory, () => call('init --json', {} as never))
  expect(repeated.type).toBe('text')
  if (repeated.type !== 'text') throw new Error('Expected scaffold report')
  expect(JSON.parse(repeated.value).skipped).toContain('example.ts')
}, 90_000)
