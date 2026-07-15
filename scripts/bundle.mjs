#!/usr/bin/env node
// Bundle the CLI, injecting the version from package.json directly — `bun run`
// does not reliably set $npm_package_version, which is why the old script could
// emit a stale version. After building, verify the version actually landed so a
// stale bundle can never be committed silently.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { name, version } = packageJson
const packageName = typeof name === 'string' ? name : 'ur-agent'
const issues =
  typeof packageJson.bugs?.url === 'string'
    ? packageJson.bugs.url
    : 'https://github.com/Maitham16/UR/issues'

if (!packageJson.dependencies?.sharp) {
  console.error(
    'FAILED: sharp is externalized from the Bun bundle and must be declared in package.json dependencies.',
  )
  process.exit(1)
}

console.log(`Bundling UR-Nexus v${version} ...`)
execFileSync(
  'bun',
  [
    'build',
    'src/entrypoints/cli.tsx',
    '--outdir',
    'dist',
    '--target',
    'bun',
    '--external',
    'sharp',
    // Optional native audio backend for voice mode — resolved at runtime,
    // degrades gracefully when not installed.
    '--external',
    'audio-capture-napi',
    // Optional browser automation backend — lazy-loaded by BrowserTool.
    '--external',
    'playwright-core',
    '--define',
    `MACRO.VERSION="${version}"`,
    '--define',
    'MACRO.BUILD_TIME=""',
    '--define',
    `MACRO.PACKAGE_URL="${packageName}"`,
    '--define',
    'MACRO.NATIVE_PACKAGE_URL=undefined',
    '--define',
    `MACRO.FEEDBACK_CHANNEL="${issues}"`,
    '--define',
    `MACRO.ISSUES_EXPLAINER="file an issue at ${issues}"`,
    '--define',
    'MACRO.VERSION_CHANGELOG=""',
    // Shipped feature flags (bun:bundle): voice mode and the computer-use
    // MCP server are part of the supported surface as of 1.45.
    '--feature=VOICE_MODE',
    '--feature=CHICAGO_MCP',
  ],
  { cwd: root, stdio: 'inherit' },
)

const distPath = join(root, 'dist', 'cli.js')
let dist = readFileSync(distPath, 'utf8')

// Bun renders shell-quote's escaped IFS literal (`' \t\n'`) as a multiline
// template literal containing a literal tab. That is semantically correct but
// creates trailing whitespace in the committed bundle. Normalize only this
// exact generated literal so release diffs remain whitespace-clean.
const normalizedDist = dist.replaceAll('` \t\n`', '" \\t\\n"')
if (normalizedDist !== dist) {
  writeFileSync(distPath, normalizedDist, 'utf8')
  dist = normalizedDist
}

const hits = dist.split(version).length - 1
if (hits === 0) {
  console.error(
    `\nFAILED: dist/cli.js does not contain version ${version} — the build did not inject MACRO.VERSION.`,
  )
  process.exit(1)
}
console.log(`OK: built and verified dist at v${version} (${hits} occurrences).`)
