#!/usr/bin/env node
import { readFileSync } from 'node:fs'

function usage() {
  return 'Usage: bun run benchmark:compare -- <before-result.json> <after-result.json>'
}

function readReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const [beforePath, afterPath] = process.argv.slice(2)
if (!beforePath || !afterPath) {
  console.error(usage())
  process.exit(1)
}

const before = readReport(beforePath)
const after = readReport(afterPath)
const beforeRate = before.results?.passRate ?? 0
const afterRate = after.results?.passRate ?? 0
const delta = afterRate - beforeRate

console.log(`Benchmark comparison:`)
console.log(`- before: ${before.benchmark?.name} ${before.results?.passed}/${before.benchmark?.taskCount} (${(beforeRate * 100).toFixed(1)}%)`)
console.log(`- after: ${after.benchmark?.name} ${after.results?.passed}/${after.benchmark?.taskCount} (${(afterRate * 100).toFixed(1)}%)`)
console.log(`- pass-rate delta: ${(delta * 100).toFixed(1)} percentage points`)

const failedAfter = after.results?.failedTasks ?? []
if (failedAfter.length > 0) {
  console.log(`- after failures: ${failedAfter.map(item => item.id).join(', ')}`)
}
