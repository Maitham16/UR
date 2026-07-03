#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  missingRequiredSourceZipEntries,
  normalizeArchiveRootPaths,
  releasePathViolations,
} from './release-hygiene.mjs'

function fail(message) {
  console.error(message)
  process.exit(1)
}

const zipPath = process.argv[2]
if (!zipPath) {
  fail('Usage: bun run release:check-source-zip -- path/to/source.zip')
}

if (!existsSync(zipPath)) {
  fail(`Source zip does not exist: ${zipPath}`)
}

const list = spawnSync('unzip', ['-Z1', zipPath], {
  encoding: 'utf8',
})

if (list.status !== 0) {
  fail(
    `Failed to list source zip ${zipPath} with unzip -Z1.\nstdout:\n${list.stdout}\nstderr:\n${list.stderr}`,
  )
}

const rawPaths = list.stdout.split('\n').map(line => line.trim()).filter(Boolean)
const paths = normalizeArchiveRootPaths(rawPaths)
const violations = releasePathViolations(paths)
const missing = missingRequiredSourceZipEntries(paths)
const failures = [
  ...violations.map(path => `forbidden artifact: ${path}`),
  ...missing.map(path => `missing required source entry: ${path}`),
]

if (failures.length > 0) {
  console.error(`Source zip check failed for ${zipPath}:`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`Source zip check passed for ${zipPath} (${paths.length} entries).`)
