import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createCloudTask } from '../src/services/agents/cloudTasks.js'

const packageRoot = resolve(import.meta.dir, '..')
const cli = join(packageRoot, 'bin', 'ur.js')

function runCli(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): { code: number; stdout: string; stderr: string } {
  const isolatedHome = join(cwd, '.cli-home')
  mkdirSync(isolatedHome, { recursive: true })
  const result = Bun.spawnSync(['node', cli, ...args], {
    cwd,
    env: {
      ...env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  // Bun reports exitCode null when the child died from a signal. Returning it
  // as-is made every such death surface as `Received: null` against whichever
  // exit code the test expected, hiding both the signal and the command. A
  // signal kill is never the clean non-zero exit these tests assert on — under
  // a full-suite run it is usually the OOM killer — so fail loudly and name it
  // rather than letting `not.toBe(0)` pass a crash.
  if (result.exitCode === null) {
    throw new Error(
      `ur ${args.join(' ')} was killed by ${result.signalCode ?? 'an unknown signal'} ` +
        `instead of exiting. stdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }
  return { code: result.exitCode, stdout, stderr }
}

test('CLI adapters preserve prompts and never promote embedded control flags', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-frontier-cli-boundary-'))
  try {
    const background = runCli(cwd, [
      'bg',
      'run',
      'fix the --pr and --skip-permissions output',
      '--dry-run',
      '--json',
    ])
    expect(
      background.code,
      `${background.stdout}\n${background.stderr}`,
    ).toBe(0)
    const payload = JSON.parse(background.stdout)
    expect(payload.task.task).toBe(
      'fix the --pr and --skip-permissions output',
    )
    expect(payload.task.pr).toBeUndefined()
    expect(payload.task.skipPermissions).toBe(false)

    const numericInjection = runCli(cwd, [
      'arena',
      'safe task',
      '--agents',
      '2 --skip-permissions',
      '--dry-run',
      '--json',
    ])
    expect(numericInjection.code).not.toBe(0)
    expect(numericInjection.stdout).toContain(
      '--agents must be an integer between 2 and 8',
    )

    const actionInjection = runCli(cwd, [
      'desktop-qa',
      'doctor --json',
    ])
    expect(actionInjection.code).not.toBe(0)
    expect(actionInjection.stdout).toContain('Usage:')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('frontier CLI automation errors are nonzero and offline mode is idempotent', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-frontier-cli-errors-'))
  try {
    const offline = runCli(
      cwd,
      ['bg', 'run', 'offline task', '--offline', '--dry-run', '--json'],
      { ...process.env, UR_OFFLINE: '1' },
    )
    expect(
      offline.code,
      `${offline.stdout}\n${offline.stderr}`,
    ).toBe(0)
    expect(JSON.parse(offline.stdout).task.task).toBe('offline task')
    expect(runCli(cwd, ['eval', 'init']).code).toBe(0)
    const unknownCategory = runCli(cwd, [
      'eval',
      'run',
      'starter',
      '--category',
      'definitely-missing',
      '--dry-run',
      '--json',
    ])
    expect(unknownCategory.code).not.toBe(0)
    expect(unknownCategory.stdout).toContain('Eval category not found')
    const backgroundId = JSON.parse(offline.stdout).task.id as string
    expect(runCli(cwd, ['bg', 'kill', backgroundId]).code).toBe(0)
    expect(runCli(cwd, ['bg', 'worker', backgroundId]).code).not.toBe(0)

    const cloud = createCloudTask(cwd, {
      task: 'cancel safely',
      attempts: 1,
    })
    expect(runCli(cwd, ['cloud', 'cancel', cloud.id]).code).toBe(0)
    expect(runCli(cwd, ['cloud', 'cancel', cloud.id]).code).not.toBe(0)
    expect(runCli(cwd, ['cloud', 'worker', cloud.id]).code).not.toBe(0)

    for (const args of [
      ['agent-ci', 'validate'],
      ['bg', 'status'],
      ['workspace', 'status'],
      ['desktop-qa', 'validate'],
      ['arena'],
      ['learn', 'playbooks', 'approve'],
      ['eval', 'compare', 'missing-suite', 'a', 'b'],
      ['eval', 'leaderboard', '--format', 'yaml'],
      [
        'cloud',
        'run',
        'local task',
        '--runner',
        'local',
        '--permission-mode',
        'plan',
      ],
    ]) {
      const result = runCli(cwd, args)
      expect(result.code, args.join(' ')).not.toBe(0)
    }

    for (const [args, message] of [
      [
        ['eval', 'run', 'starter', '--repeat', '', '--dry-run'],
        '--repeat must be a positive integer',
      ],
      [
        ['bg', 'run', 'task', '--max-turns', '', '--dry-run'],
        '--max-turns must be a positive integer',
      ],
      [
        ['arena', 'task', '--judge', '', '--dry-run'],
        '--judge must be deterministic, model, or hybrid',
      ],
      [
        ['learn', 'playbooks', 'mine', '--min-runs', '', '--dry-run'],
        '--min-runs must be an integer of at least 2',
      ],
    ] as const) {
      const result = runCli(cwd, [...args])
      expect(result.code, args.join(' ')).not.toBe(0)
      expect(result.stdout, args.join(' ')).toContain(message)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
  // ~24 real CLI spawns. At 20s that allowed 830ms each, which a cold or
  // loaded machine exceeds — the suite then reported a timeout that looked
  // like a product regression and cost real time to disprove. Node startup
  // dominates here and is environment-bound, so budget generously; the
  // assertions above are what this test is for.
}, 90_000)

test('eval route preserves option-like task text', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-frontier-cli-eval-route-'))
  try {
    const result = runCli(
      cwd,
      [
        'eval',
        'route',
        'fix the --strategy parser',
        '--offline',
        '--json',
      ],
      { ...process.env, UR_OFFLINE: '1' },
    )
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(JSON.parse(result.stdout).task).toBe('fix the --strategy parser')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
