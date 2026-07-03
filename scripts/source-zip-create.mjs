#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releasePathViolations } from './release-hygiene.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(await Bun.file(join(root, 'package.json')).text()).version
const output =
  process.argv[2] ?? join(root, 'artifacts', 'source', `ur-agent-${version}-source.zip`)

function normalize(path) {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function isForbidden(path) {
  return releasePathViolations([path]).length > 0
}

function collectFiles() {
  const files = []
  const pending = ['.']
  const outputRel = normalize(relative(root, output))

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    const normalized = normalize(current)
    if (normalized === '.git' || normalized.startsWith('.git/')) continue
    if (normalized !== '.' && isForbidden(normalized)) continue

    const absolute = join(root, current)
    let stat
    try {
      stat = lstatSync(absolute)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute)) {
        pending.push(current === '.' ? entry : `${current}${sep}${entry}`)
      }
    } else if (stat.isFile()) {
      const rel = normalize(relative(root, absolute))
      if (rel === outputRel || isForbidden(rel)) continue
      files.push(rel)
    }
  }

  return files.sort()
}

mkdirSync(dirname(output), { recursive: true })
const files = collectFiles()
const result = spawnSync('zip', ['-q', output, '-@'], {
  cwd: root,
  input: `${files.join('\n')}\n`,
  encoding: 'utf8',
})

if (result.status !== 0) {
  console.error(`Failed to create source zip ${output}`)
  if (result.stderr) console.error(result.stderr)
  process.exit(result.status ?? 1)
}

console.log(`Wrote source zip: ${output} (${files.length} files)`)
