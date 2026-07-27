#!/usr/bin/env node
/**
 * Publish GitHub Releases for tags that predate the release workflow.
 *
 * Only tags whose CHANGELOG.md has a matching section are eligible: a release
 * page with invented notes is worse than no release page. Existing releases are
 * left alone unless --force is passed, and nothing is created without --apply.
 *
 * Usage:
 *   node scripts/backfill-releases.mjs            # dry run, shows the plan
 *   node scripts/backfill-releases.mjs --apply    # create the missing releases
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')

function run(file, args) {
  return execFileSync(file, args, { encoding: 'utf8' }).trim()
}

function tryRun(file, args) {
  try {
    // stderr is piped, not inherited: `gh release view` writes "release not
    // found" for every unpublished tag, which is an expected answer here and
    // would otherwise bury the plan in noise.
    return {
      ok: true,
      out: execFileSync(file, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    }
  } catch (error) {
    return { ok: false, out: String(error.stderr ?? error.message ?? error) }
  }
}

/** Extract the CHANGELOG section for a version, or null when absent. */
function notesFor(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex(line => line.trim() === `## ${version}`)
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
  return body || null
}

const gh = tryRun('gh', ['--version'])
if (!gh.ok) {
  console.error('gh CLI is required. Install it and run: gh auth login')
  process.exit(1)
}

const changelog = readFileSync('CHANGELOG.md', 'utf8')
const tags = run('git', ['tag', '-l', 'v*'])
  .split('\n')
  .filter(Boolean)
  .filter(tag => /^v\d+\.\d+\.\d+$/.test(tag))
  .sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  )

const plan = []
for (const tag of tags) {
  const version = tag.slice(1)
  const notes = notesFor(changelog, version)
  const exists = tryRun('gh', ['release', 'view', tag]).ok
  if (exists && !force) {
    plan.push({ tag, action: 'skip', reason: 'release already exists' })
    continue
  }
  if (!notes) {
    plan.push({ tag, action: 'skip', reason: 'no CHANGELOG section' })
    continue
  }
  plan.push({ tag, action: exists ? 'update' : 'create', notes })
}

for (const item of plan) {
  const suffix = item.reason ? ` (${item.reason})` : ''
  console.log(`${item.action.padEnd(6)} ${item.tag}${suffix}`)
}

const actionable = plan.filter(item => item.action !== 'skip')
if (!apply) {
  console.log(
    `\n${actionable.length} release(s) would be published. Re-run with --apply.`,
  )
  process.exit(0)
}

let failures = 0
for (const item of actionable) {
  const args =
    item.action === 'create'
      ? ['release', 'create', item.tag, '--title', `UR-Nexus ${item.tag.slice(1)}`, '--notes', item.notes, '--verify-tag']
      : ['release', 'edit', item.tag, '--title', `UR-Nexus ${item.tag.slice(1)}`, '--notes', item.notes]
  const result = tryRun('gh', args)
  if (result.ok) {
    console.log(`published ${item.tag}`)
  } else {
    failures++
    console.error(`failed ${item.tag}: ${result.out}`)
  }
}
process.exit(failures === 0 ? 0 : 1)
