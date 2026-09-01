import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

test('explicit KAIROS CLI feature build and tool pool are runnable', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'ur-kairos-build-'))
  try {
    const build = Bun.spawn(
      [
        process.execPath,
        'build',
        'src/entrypoints/cli.tsx',
        'test/fixtures/kairosToolPoolProbe.ts',
        '--outdir',
        outdir,
        '--target',
        'bun',
        '--external',
        'sharp',
        '--external',
        'audio-capture-napi',
        '--external',
        'playwright-core',
        '--define',
        'MACRO.VERSION="test"',
        '--define',
        'MACRO.BUILD_TIME=""',
        '--define',
        'MACRO.PACKAGE_URL="ur-agent"',
        '--define',
        'MACRO.NATIVE_PACKAGE_URL=undefined',
        '--define',
        'MACRO.FEEDBACK_CHANNEL=""',
        '--define',
        'MACRO.ISSUES_EXPLAINER=""',
        '--define',
        'MACRO.VERSION_CHANGELOG=""',
        '--feature=KAIROS',
      ],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' },
    )
    const [buildStdout, buildStderr, buildCode] = await Promise.all([
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
      build.exited,
    ])
    expect(buildCode, `${buildStdout}\n${buildStderr}`).toBe(0)

    // The real CLI entrypoint pulls in main.tsx, REPL, commands, assistant
    // gates, bridge/viewer code, and every other explicit KAIROS branch. A
    // startup-safe --help run catches module-initialization failures that a
    // compile-only check cannot.
    const cli = Bun.spawn(
      [process.execPath, join(outdir, 'src', 'entrypoints', 'cli.js'), '--help'],
      {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production', USER_TYPE: 'external' },
      stdout: 'pipe',
      stderr: 'pipe',
      },
    )
    const [cliStdout, cliStderr, cliCode] = await Promise.all([
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
      cli.exited,
    ])
    expect(cliCode, cliStderr).toBe(0)
    expect(cliStdout).toContain('Usage:')

    const executable = join(
      outdir,
      'test',
      'fixtures',
      'kairosToolPoolProbe.js',
    )
    const run = Bun.spawn([process.execPath, executable], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production', USER_TYPE: 'external' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
      run.exited,
    ])
    expect(code, stderr).toBe(0)
    const result = JSON.parse(stdout) as { count: number; names: string[] }
    expect(result.count).toBeGreaterThan(20)
    expect(result.names).toEqual(
      expect.arrayContaining(['Sleep', 'SendUserFile', 'PushNotification']),
    )
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}, 60_000)
