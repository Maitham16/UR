import { expect, test } from 'bun:test'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createBackgroundTask,
  backgroundDir,
  commitIfNeeded,
  createPullRequest,
  establishPrTrust,
  getBackgroundTask,
  MAX_BACKGROUND_INBOX_BYTES,
  readInboxEntriesFromOffset,
  runBackgroundWorker,
  stopBackgroundTask,
} from '../src/services/agents/backgroundRunner.js'

test('background PRs require an isolated worktree', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-bg-pr-isolation-'))
  try {
    expect(() =>
      createBackgroundTask({
        cwd,
        task: 'do not touch local changes',
        pr: true,
      }),
    ).toThrow(/require --worktree/i)
    expect(existsSync(join(cwd, '.ur'))).toBe(false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('background inbox preserves partial records and enforces byte limits', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-bg-inbox-bounds-'))
  const inbox = join(cwd, 'inbox.jsonl')
  try {
    writeFileSync(
      inbox,
      '{"requestId":"one","text":"hel',
    )
    expect(readInboxEntriesFromOffset(inbox, 0)).toEqual({
      nextOffset: 0,
      entries: [],
    })
    appendFileSync(inbox, 'lo"}\n')
    const complete = readInboxEntriesFromOffset(inbox, 0)
    expect(complete.entries.map(entry => entry.text)).toEqual(['hello'])
    expect(complete.nextOffset).toBeGreaterThan(0)

    writeFileSync(
      inbox,
      `${JSON.stringify({
        requestId: 'large',
        text: 'x'.repeat(64 * 1024 + 1),
      })}\n`,
    )
    expect(readInboxEntriesFromOffset(inbox, 0).entries).toEqual([])

    writeFileSync(inbox, Buffer.alloc(MAX_BACKGROUND_INBOX_BYTES + 1))
    expect(() => readInboxEntriesFromOffset(inbox, 0)).toThrow(/8 MiB/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

test('a canceled queued background task cannot be resurrected by its worker', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-bg-cancel-race-'))
  try {
    const task = createBackgroundTask({
      cwd,
      task: 'must never start',
      dryRun: true,
    })
    expect(stopBackgroundTask(cwd, task.id)?.status).toBe('canceled')
    const result = await runBackgroundWorker(cwd, task.id)
    expect(result.status).toBe('canceled')
    expect(getBackgroundTask(cwd, task.id)?.status).toBe('canceled')
    expect(result.startedAt).toBeUndefined()
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('stopping a terminal task never signals a stale persisted PID', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-bg-terminal-kill-'))
  try {
    const task = createBackgroundTask({
      cwd,
      task: 'already finished',
      dryRun: true,
    })
    const path = join(backgroundDir(cwd), 'tasks.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      tasks: Array<Record<string, unknown>>
    }
    manifest.tasks[0]!.status = 'completed'
    manifest.tasks[0]!.workerPid = 424_242
    manifest.tasks[0]!.agentPid = 424_243
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)

    const signaled: number[] = []
    const result = stopBackgroundTask(cwd, task.id, pid => {
      signaled.push(pid)
      return true
    })

    expect(result?.status).toBe('completed')
    expect(result?.workerPid).toBeUndefined()
    expect(result?.agentPid).toBeUndefined()
    expect(signaled).toEqual([])
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('canceling a running task never signals a persisted PID', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-bg-running-stale-pid-'))
  try {
    const task = createBackgroundTask({
      cwd,
      task: 'stale worker',
      dryRun: true,
    })
    const path = join(backgroundDir(cwd), 'tasks.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      tasks: Array<Record<string, unknown>>
    }
    manifest.tasks[0]!.status = 'running'
    manifest.tasks[0]!.workerPid = 424_242
    manifest.tasks[0]!.agentPid = 424_243
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)

    const signaled: number[] = []
    const result = stopBackgroundTask(cwd, task.id, pid => {
      signaled.push(pid)
      return true
    })

    expect(result?.status).toBe('canceled')
    expect(signaled).toEqual([])
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('background git hooks cannot inherit provider credentials', async () => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'ur-bg-hook-'))
  const repo = join(root, 'repo')
  const ran = join(root, 'hook-ran')
  const leaked = join(root, 'hook-leaked')
  const key = 'UR_BACKGROUND_HOOK_TOKEN'
  const previous = process.env[key]
  try {
    mkdirSync(repo)
    git(repo, 'init')
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test')
    writeFileSync(join(repo, 'file.txt'), 'base\n')
    git(repo, 'add', 'file.txt')
    git(repo, 'commit', '-m', 'base')
    const hook = join(repo, '.git', 'hooks', 'pre-commit')
    writeFileSync(
      hook,
      `#!/bin/sh\nprintf ran > ${JSON.stringify(ran)}\nif [ -n "\${${key}:-}" ]; then printf leaked > ${JSON.stringify(leaked)}; fi\n`,
    )
    chmodSync(hook, 0o700)
    process.env[key] = 'must-not-reach-hook'
    const task = createBackgroundTask({
      cwd: repo,
      task: 'commit safely',
      dryRun: true,
    })
    writeFileSync(join(repo, 'file.txt'), 'changed\n')

    await commitIfNeeded(task, repo)
    expect(existsSync(ran)).toBe(false)
    expect(existsSync(leaked)).toBe(false)
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('background PR publishing rejects a changed origin', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ur-bg-pr-trust-'))
  const repo = join(root, 'repo')
  try {
    mkdirSync(repo)
    git(repo, 'init')
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'remote', 'add', 'origin', 'https://github.com/example/repo.git')
    writeFileSync(join(repo, 'file.txt'), 'base\n')
    git(repo, 'add', 'file.txt')
    git(repo, 'commit', '-m', 'base')
    const task = createBackgroundTask({
      cwd: repo,
      task: 'safe PR',
      worktree: true,
      pr: true,
      dryRun: true,
    })
    const worktree = task.worktree!.path!
    mkdirSync(join(worktree, '..'), { recursive: true })
    git(
      repo,
      'worktree',
      'add',
      '-b',
      task.branch!,
      worktree,
      'HEAD',
    )
    task.pr!.trust = await establishPrTrust(task, worktree)
    git(
      repo,
      'remote',
      'set-url',
      'origin',
      'https://github.com/attacker/repo.git',
    )

    await expect(createPullRequest(task, worktree)).rejects.toThrow(
      /trust state changed/i,
    )
    expect(
      Bun.spawnSync(['git', 'status', '--porcelain'], {
        cwd: worktree,
        stdout: 'pipe',
      }).stdout.toString(),
    ).toBe('')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
