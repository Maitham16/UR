import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveUrExecutable } from '../src/utils/urExecutable.ts'

describe('UR executable resolution', () => {
  test('source and JS distributions invoke the script through the current runtime', () => {
    expect(resolveUrExecutable({ native: false, execPath: '/runtime/bun', entrypoint: '/install path/cli.js' }))
      .toEqual({ file: '/runtime/bun', baseArgs: ['/install path/cli.js'] })
  })

  test('standalone distributions never pass their virtual entrypoint to themselves', () => {
    expect(resolveUrExecutable({ native: true, execPath: '/install path/ur', entrypoint: '/$bunfs/root/cli' }))
      .toEqual({ file: '/install path/ur', baseArgs: [] })
  })
})

describe('standalone process launch and timeout contract', () => {
  let workDir: string
  let binary: string
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ur-runtime-'))
    const fixture = join(workDir, 'fixture.ts')
    binary = join(workDir, process.platform === 'win32' ? 'UR test.exe' : 'UR test')
    writeFileSync(fixture, `
import { execFileSync } from 'node:child_process';
import { resolveUrExecutable } from ${JSON.stringify(resolve('src/utils/urExecutable.ts'))};
import { isInBundledMode } from ${JSON.stringify(resolve('src/utils/bundledMode.ts'))};
import { runInternalTimeout } from ${JSON.stringify(resolve('src/utils/shell/internalTimeout.ts'))};
const args = process.argv.slice(2);
if (args[0] === '--internal-timeout') process.exitCode = await runInternalTimeout(args.slice(1));
else if (args[0] === '--child') console.log(JSON.stringify(args.slice(1)));
else {
  const entry = resolveUrExecutable({ preferStable: args[0] === '--stable' });
  const output = execFileSync(entry.file, [...entry.baseArgs, '--child', 'prompt with spaces', '--model', 'fixture'], { encoding: 'utf8' });
  console.log(JSON.stringify({ native: isInBundledMode(), assets: Bun.embeddedFiles.length, entry, child: JSON.parse(output) }));
}
`)
    const built = spawnSync(process.execPath, ['build', fixture, '--compile', '--define', 'UR_NATIVE_BUILD=true', '--outfile', binary], {
      encoding: 'utf8', timeout: 60_000,
    })
    if (built.status !== 0) throw new Error(`Runtime fixture compilation failed: ${built.stderr}`)
  }, 70_000)
  afterAll(() => { if (workDir) rmSync(workDir, { recursive: true, force: true }) })

  const run = (args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(binary, args, {
    cwd: workDir,
    env: { ...process.env, PATH: '', ...env },
    encoding: 'utf8', timeout: 10_000,
  })

  test('a zero-asset executable reexecutes from an unrelated directory without Node or Bun', () => {
    const result = run([])
    expect(result.status).toBe(0)
    const body = JSON.parse(result.stdout)
    expect(body.native).toBe(true)
    expect(body.assets).toBe(0)
    expect(body.entry.baseArgs).toEqual([])
    expect(body.child).toEqual(['prompt with spaces', '--model', 'fixture'])
  })

  test.skipIf(process.platform === 'win32')('persisted launchers use the managed stable symlink', () => {
    const stable = join(workDir, '.local', 'bin', 'ur')
    mkdirSync(join(workDir, '.local', 'bin'), { recursive: true })
    symlinkSync(binary, stable)
    const result = run(['--stable'], { HOME: workDir })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).entry.file).toBe(stable)
  })

  test.skipIf(process.platform === 'win32')('typed timeout preserves command status and validates arguments', () => {
    expect(run(['--internal-timeout', '2s', '/bin/sh', '-c', 'exit 7']).status).toBe(7)
    expect(run(['--internal-timeout', 'bad', '/bin/sh']).status).toBe(125)
    expect(run(['--internal-timeout', '-s', 'NOT_A_SIGNAL', '1s', '/bin/sh']).status).toBe(125)
    expect(run(['--internal-timeout', '1s', '/not/a/command']).status).toBe(127)
  })

  test.skipIf(process.platform === 'win32')('typed timeout expires with 124 and kills descendants that ignore TERM', async () => {
    const escaped = join(workDir, 'escaped.txt')
    const script = `trap '' TERM; (/bin/sleep 0.6; echo escaped > "$1") & wait`
    const result = run(['--internal-timeout', '--kill-after=0.1s', '0.1s', '/bin/sh', '-c', script, 'fixture', escaped])
    expect(result.status).toBe(124)
    await new Promise(resolve => setTimeout(resolve, 700))
    expect(existsSync(escaped)).toBe(false)
  })

  test.skipIf(process.platform === 'win32')('an exited process group does not wait for a long kill-after deadline', () => {
    const result = spawnSync(binary, ['--internal-timeout', '--kill-after=30s', '0.1s', '/bin/sleep', '5'], {
      env: { ...process.env, PATH: '' }, encoding: 'utf8', timeout: 2_000,
    })
    expect(result.status).toBe(124)
    expect(result.error).toBeUndefined()
  })
})
