import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'release-tag.mjs')

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function writeRelease(root: string, version: string): void {
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'release-fixture', version }, null, 2)}\n`,
  )
  writeFileSync(join(root, 'CHANGELOG.md'), `# Changelog\n\n## ${version}\n\n- Test release.\n`)
}

function fixture(version = '2.0.0'): { root: string; remote: string } {
  const parent = mkdtempSync(join(tmpdir(), 'ur-release-tag-'))
  const root = join(parent, 'repo')
  const remote = join(parent, 'remote.git')
  mkdirSync(root)
  git(root, ['init', '--initial-branch=master'])
  git(root, ['config', 'user.name', 'Release Test'])
  git(root, ['config', 'user.email', 'release@example.test'])
  writeRelease(root, version)
  git(root, ['add', 'package.json', 'CHANGELOG.md'])
  git(root, ['commit', '--message', `release ${version}`])
  git(parent, ['init', '--bare', remote])
  git(root, ['remote', 'add', 'origin', remote])
  git(root, ['push', '--set-upstream', 'origin', 'master'])
  return { root, remote }
}

function run(root: string, ...args: string[]) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

test('release tag preflight refuses a dirty working tree', () => {
  const { root } = fixture()
  try {
    writeFileSync(join(root, 'uncommitted.txt'), 'not in the release commit\n')
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('working tree is not clean')
  } finally {
    rmSync(join(root, '..'), { recursive: true, force: true })
  }
})

test('release tag preflight refuses a release commit that was not pushed', () => {
  const { root } = fixture()
  try {
    writeRelease(root, '2.0.1')
    git(root, ['add', 'package.json', 'CHANGELOG.md'])
    git(root, ['commit', '--message', 'release 2.0.1'])
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('push the release commit first')
  } finally {
    rmSync(join(root, '..'), { recursive: true, force: true })
  }
})

test('release tag command pushes exactly the verified release commit', () => {
  const { root, remote } = fixture()
  try {
    const check = run(root, '--check')
    expect(check.status, check.stderr).toBe(0)
    expect(check.stdout).toContain('Release tag preflight passed for v2.0.0')

    const pushed = run(root, '--push')
    expect(pushed.status, pushed.stderr).toBe(0)
    const head = git(root, ['rev-parse', 'HEAD'])
    const remoteCommit = git(root, [
      '--git-dir',
      remote,
      'rev-list',
      '--max-count=1',
      'refs/tags/v2.0.0',
    ])
    expect(remoteCommit).toBe(head)

    const repeated = run(root, '--check')
    expect(repeated.status).toBe(1)
    expect(repeated.stderr).toContain('local tag v2.0.0 already exists')
  } finally {
    rmSync(join(root, '..'), { recursive: true, force: true })
  }
})
