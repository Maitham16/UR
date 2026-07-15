#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  releasePathViolations,
  sourceArchiveCandidatePaths,
} from './release-hygiene.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(await Bun.file(join(root, 'package.json')).text()).version
const output =
  process.argv[2] ?? join(root, 'artifacts', 'source', `ur-nexus-${version}-source.zip`)

function normalize(path) {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function isForbidden(path) {
  return releasePathViolations([path]).length > 0
}

function collectFiles() {
  const outputRel = normalize(relative(root, output))
  const files = sourceArchiveCandidatePaths(root).flatMap(candidate => {
    const rel = normalize(candidate)
    if (!rel || rel === outputRel || isForbidden(rel)) return []
    try {
      return lstatSync(join(root, rel)).isFile() ? [rel] : []
    } catch {
      return []
    }
  })

  return [...new Set(files)].sort()
}

mkdirSync(dirname(output), { recursive: true })
const files = collectFiles()
const temporaryOutput = `${output}.${process.pid}.tmp.zip`
rmSync(temporaryOutput, { force: true })
const result = spawnSync('zip', ['-q', temporaryOutput, '-@'], {
  cwd: root,
  input: `${files.join('\n')}\n`,
  encoding: 'utf8',
})

if (result.status !== 0) {
  rmSync(temporaryOutput, { force: true })
  console.error(`Failed to create source zip ${output}`)
  if (result.stderr) console.error(result.stderr)
  process.exit(result.status ?? 1)
}

renameSync(temporaryOutput, output)
console.log(`Wrote source zip: ${output} (${files.length} files)`)
