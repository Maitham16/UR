#!/usr/bin/env node
// Bundle the CLI, injecting the version from package.json directly — `bun run`
// does not reliably set $npm_package_version, which is why the old script could
// emit a stale version. After building, verify the version actually landed so a
// stale bundle can never be committed silently.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { name, version } = packageJson
const packageName = typeof name === 'string' ? name : 'ur-agent'
const issues =
  typeof packageJson.bugs?.url === 'string'
    ? packageJson.bugs.url
    : 'https://github.com/Maitham16/UR-mapek/issues'

console.log(`Bundling UR v${version} ...`)
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
  ],
  { cwd: root, stdio: 'inherit' },
)

const dist = readFileSync(join(root, 'dist', 'cli.js'), 'utf8')
const hits = dist.split(version).length - 1
if (hits === 0) {
  console.error(
    `\nFAILED: dist/cli.js does not contain version ${version} — the build did not inject MACRO.VERSION.`,
  )
  process.exit(1)
}
console.log(`OK: built and verified dist at v${version} (${hits} occurrences).`)
