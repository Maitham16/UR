#!/usr/bin/env node
/**
 * Create the one tag that starts the release workflow, but only when the tag
 * is guaranteed to name the committed, pushed release revision.
 *
 * The command is a read-only preflight by default. `--push` creates an
 * annotated local tag and pushes only that exact ref after every check passes.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { valid as validSemver } from 'semver'

const root = process.cwd()
const args = process.argv.slice(2)
const push = args.includes('--push')
const unknown = args.filter(argument => argument !== '--push' && argument !== '--check')

if (unknown.length > 0) {
  console.error('usage: node scripts/release-tag.mjs [--check|--push]')
  process.exit(1)
}

function runGit(gitArgs, { allowFailure = false } = {}) {
  const result = spawnSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!allowFailure && result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'git command failed').trim()
    throw new Error(`git ${gitArgs.join(' ')}: ${detail}`)
  }
  return result
}

function git(gitArgs) {
  return runGit(gitArgs).stdout.trim()
}

function fail(message) {
  console.error(`Release tag preflight failed: ${message}`)
  process.exit(1)
}

let packageJson
try {
  packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
} catch (error) {
  fail(`cannot read package.json: ${error instanceof Error ? error.message : String(error)}`)
}

const version = packageJson?.version
if (typeof version !== 'string' || validSemver(version) === null) {
  fail(`package.json version is not publishable semver: ${String(version)}`)
}
const tag = `v${version}`

try {
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'])
  if (dirty) {
    fail('the working tree is not clean; commit the complete release before tagging')
  }

  const branch = git(['branch', '--show-current'])
  if (!branch) fail('HEAD is detached; check out the release branch before tagging')

  const head = git(['rev-parse', 'HEAD'])
  const committedPackage = JSON.parse(git(['show', 'HEAD:package.json']))
  if (committedPackage.version !== version) {
    fail(
      `working package.json is ${version}, but HEAD contains ${String(committedPackage.version)}; commit the bump first`,
    )
  }
  const committedChangelog = git(['show', 'HEAD:CHANGELOG.md'])
  const newestChangelogVersion = committedChangelog.match(/^## (\S+)$/m)?.[1]
  if (newestChangelogVersion !== version) {
    fail(
      `HEAD changelog starts at ${newestChangelogVersion ?? 'no version'}, expected ${version}`,
    )
  }

  const remoteBranch = runGit(
    ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`],
    { allowFailure: true },
  )
  if (remoteBranch.status !== 0) {
    fail(`cannot read origin/${branch}: ${(remoteBranch.stderr || remoteBranch.stdout).trim()}`)
  }
  const remoteHead = remoteBranch.stdout.trim().split(/\s+/)[0]
  if (!remoteHead) fail(`origin/${branch} does not exist; push the release branch first`)
  if (remoteHead !== head) {
    fail(`origin/${branch} is at ${remoteHead}, but the release commit is ${head}; push the release commit first`)
  }

  const localTag = runGit(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], {
    allowFailure: true,
  })
  if (localTag.status === 0) fail(`local tag ${tag} already exists; versions and tags are immutable`)

  const remoteTag = runGit(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
    allowFailure: true,
  })
  if (remoteTag.status !== 0) {
    fail(`cannot inspect remote tag ${tag}: ${(remoteTag.stderr || remoteTag.stdout).trim()}`)
  }
  if (remoteTag.stdout.trim()) {
    fail(`remote tag ${tag} already exists; bump to a fresh version instead of moving it`)
  }

  if (!push) {
    console.log(`Release tag preflight passed for ${tag} at ${head} on origin/${branch}.`)
    console.log('Run `bun run release:tag -- --push` to create and push the immutable tag.')
    process.exit(0)
  }

  runGit(['tag', '--annotate', tag, '--message', `UR-Nexus ${version}`])
  const pushed = runGit(['push', 'origin', `refs/tags/${tag}`], {
    allowFailure: true,
  })
  if (pushed.status !== 0) {
    // This tag was created by this invocation and never reached the remote, so
    // removing it restores the exact pre-command state and makes retry safe.
    runGit(['tag', '--delete', tag], { allowFailure: true })
    fail(`could not push ${tag}: ${(pushed.stderr || pushed.stdout).trim()}`)
  }
  console.log(`Pushed ${tag} at ${head}. GitHub Actions now owns release and npm publication.`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
