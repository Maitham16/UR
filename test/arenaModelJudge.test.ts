import { expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createArenaWorktree,
  captureArenaDiff,
  judgeArenaCandidates,
  makeArenaModelJudge,
  redactArenaText,
  scoreCandidate,
  verifyCandidate,
  type ScoredCandidate,
} from '../src/services/agents/arena.ts'
import type {
  HeadlessRunOptions,
  HeadlessRunner,
} from '../src/services/agents/headlessAgent.ts'

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function gitOutput(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

function scored(
  id: string,
  eligible = true,
): ScoredCandidate {
  const value = scoreCandidate({
    id,
    diff: '+++ b/x.ts\n@@ -0,0 +1 @@\n+export const x = 1',
    output: '',
    verdict: eligible ? 'PASS' : 'FAIL',
    isError: false,
    verification: { passed: true, checks: [] },
  })
  return value
}

test('model judge runs one-turn with no tools and no session persistence', async () => {
  let seen: HeadlessRunOptions | undefined
  const runner: HeadlessRunner = async options => {
    seen = options
    return {
      output:
        '```json\n{"winnerId":"candidate-1","ranking":["candidate-1"],"confidence":0.9,"rationale":"best"}\n```',
      verdict: null,
      isError: false,
    }
  }
  const judge = makeArenaModelJudge(runner, {
    cwd: '/tmp',
    model: 'judge-model',
    maxTurns: 99,
  })
  const result = await judge({
    task: 'fix',
    rubric: 'correct',
    candidates: [
      {
        id: 'candidate-1',
        diff: 'patch',
        diffTruncated: false,
        originalBytes: 5,
        verification: { passed: true, checks: [] },
        safety: { blocking: 0, warnings: 0 },
      },
    ],
  })
  expect(result).toMatchObject({ winnerId: 'candidate-1' })
  expect(seen?.tools).toEqual([])
  expect(seen?.maxTurns).toBe(1)
  expect(seen?.noSessionPersistence).toBe(true)
  expect(seen?.env?.UR_CODE_SUBPROCESS_ENV_SCRUB).toBe('1')
})

test('model decisions fail closed and preserve ineligible candidates', async () => {
  const eligible = scored('good')
  const blocked = scored('blocked', false)
  const invalid = await judgeArenaCandidates('task', [eligible, blocked], {
    mode: 'model',
    modelJudge: async () => ({
      winnerId: 'candidate-2',
      ranking: ['candidate-2', 'candidate-1'],
      confidence: 1,
      rationale: 'unsafe',
    }),
  })
  expect(invalid.winner).toBeNull()
  expect(invalid.ranked.map(candidate => candidate.id)).toContain('blocked')

  const valid = await judgeArenaCandidates('task', [eligible, blocked], {
    mode: 'hybrid',
    modelJudge: async () => ({
      winnerId: 'candidate-1',
      ranking: ['candidate-1'],
      confidence: 0.8,
      rationale: 'verified',
    }),
  })
  expect(valid.winner?.id).toBe('good')
  expect(valid.ranked.map(candidate => candidate.id)).toEqual([
    'good',
    'blocked',
  ])
})

test('arena redacts secret-like tokens before judging or artifacts', () => {
  const token = 'ghp_' + 'a'.repeat(32)
  expect(redactArenaText(`token=${token}`)).not.toContain(token)
  expect(redactArenaText(`token=${token}`)).toContain('[REDACTED]')
})

test('arena redacts task and rubric before calling a model judge', async () => {
  const token = 'ghp_' + 'b'.repeat(32)
  let received = ''
  await judgeArenaCandidates(`fix with ${token}`, [scored('good')], {
    mode: 'model',
    rubric: `prefer ${token}`,
    modelJudge: async input => {
      received = `${input.task}\n${input.rubric}`
      return {
        winnerId: 'candidate-1',
        ranking: ['candidate-1'],
        confidence: 1,
        rationale: 'verified',
      }
    },
  })
  expect(received).not.toContain(token)
  expect(received).toContain('[REDACTED]')
})

test('model judging excludes candidates whose full diff cannot be reviewed', async () => {
  const large = {
    ...scored('large'),
    diff: `+++ b/x.ts\n${'+x\\n'.repeat(20_000)}`,
  }
  const small = scored('small')
  let candidates = 0
  const result = await judgeArenaCandidates('task', [large, small], {
    mode: 'model',
    modelJudge: async input => {
      candidates = input.candidates.length
      expect(input.candidates[0]?.diffTruncated).toBe(false)
      expect(input.candidates[0]?.originalBytes).toBeGreaterThan(0)
      return {
        winnerId: 'candidate-1',
        ranking: ['candidate-1'],
        confidence: 1,
        rationale: 'fully reviewed',
      }
    },
  })
  expect(candidates).toBe(1)
  expect(result.winner?.id).toBe('small')
  expect(result.ranked.find(candidate => candidate.id === 'large')).toMatchObject(
    {
      eligible: false,
    },
  )
})

test('verification fails closed when a check mutates the judged patch', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-arena-verify-bind-'))
  try {
    git(cwd, ['init'])
    git(cwd, ['config', 'user.email', 'test@example.com'])
    git(cwd, ['config', 'user.name', 'Test'])
    writeFileSync(join(cwd, 'file.txt'), 'base\n')
    git(cwd, ['add', 'file.txt'])
    git(cwd, ['commit', '-m', 'base'])
    writeFileSync(join(cwd, 'file.txt'), 'candidate\n')
    git(cwd, ['add', '-A'])
    const before = Bun.spawnSync(
      ['git', 'diff', '--cached', '--no-ext-diff', '--binary'],
      { cwd, stdout: 'pipe', stderr: 'pipe' },
    ).stdout.toString()
    const result = await verifyCandidate(
      cwd,
      [
        {
          file: 'sh',
          args: ['-c', 'printf verifier-mutation >> file.txt'],
        },
      ],
      before,
    )
    expect(result.passed).toBe(false)
    expect(result.checks.at(-1)).toMatchObject({
      name: 'verification patch integrity',
      exitCode: 1,
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('arena verification children cannot inherit ambient secrets', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-arena-env-'))
  const key = 'UR_ARENA_TEST_TOKEN'
  const previous = process.env[key]
  process.env[key] = 'must-not-reach-verifier'
  try {
    const result = await verifyCandidate(cwd, [
      {
        file: process.execPath,
        args: [
          '-e',
          `process.exit(process.env.${key} === undefined ? 0 : 1)`,
        ],
      },
    ])
    expect(result.passed).toBe(true)
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('arena worktree hooks cannot inherit ambient credentials', async () => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'ur-arena-hook-'))
  const repo = join(root, 'repo')
  const worktrees = join(root, 'worktrees')
  const ran = join(root, 'hook-ran')
  const leaked = join(root, 'hook-leaked')
  const key = 'UR_ARENA_HOOK_TOKEN'
  const previous = process.env[key]
  try {
    mkdirSync(repo)
    git(repo, ['init'])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    writeFileSync(join(repo, 'file.txt'), 'base\n')
    git(repo, ['add', 'file.txt'])
    git(repo, ['commit', '-m', 'base'])
    const hook = join(repo, '.git', 'hooks', 'post-checkout')
    writeFileSync(
      hook,
      `#!/bin/sh\nprintf ran > ${JSON.stringify(ran)}\nif [ -n "\${${key}:-}" ]; then printf leaked > ${JSON.stringify(leaked)}; fi\n`,
    )
    chmodSync(hook, 0o700)
    process.env[key] = 'must-not-reach-hook'

    const created = await createArenaWorktree(
      repo,
      worktrees,
      'candidate',
      gitOutput(repo, ['rev-parse', 'HEAD']),
    )
    expect(created).not.toBeNull()
    expect(existsSync(ran)).toBe(false)
    expect(existsSync(leaked)).toBe(false)
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('arena rejects verification lists beyond the execution limit', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-arena-verify-limit-'))
  try {
    const commands = Array.from({ length: 33 }, (_, index) => ({
      name: `check-${index}`,
      file: process.execPath,
      args: ['-e', index === 32 ? 'process.exit(9)' : 'process.exit(0)'],
    }))
    const result = await verifyCandidate(cwd, commands)
    expect(result.passed).toBe(false)
    expect(result.checks[0]?.name).toBe('verification command limit')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('arena diff capture never executes textconv helpers', async () => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'ur-arena-textconv-'))
  const repo = join(root, 'repo')
  const helper = join(root, 'textconv.sh')
  const ran = join(root, 'textconv-ran')
  try {
    mkdirSync(repo)
    writeFileSync(
      helper,
      `#!/bin/sh\nprintf ran > ${JSON.stringify(ran)}\ncat "$1"\n`,
    )
    chmodSync(helper, 0o700)
    git(repo, ['init'])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    git(repo, ['config', 'diff.leak.textconv', helper])
    writeFileSync(join(repo, '.gitattributes'), 'file.txt diff=leak\n')
    writeFileSync(join(repo, 'file.txt'), 'base\n')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'base'])
    writeFileSync(join(repo, 'file.txt'), 'changed\n')

    const captured = await captureArenaDiff(repo)
    expect(captured.violation).toBeUndefined()
    expect(captured.diff).toContain('changed')
    expect(existsSync(ran)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
