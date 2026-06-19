#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function fail(message) {
  failures.push(message)
}

const packageJson = JSON.parse(read('package.json'))
const version = packageJson.version

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`package.json version is not valid semver: ${version}`)
}

const expectedRepo = 'Maitham16/UR-mapek'
if (!packageJson.repository?.url?.includes(expectedRepo)) {
  fail(`package.json repository must point at ${expectedRepo}`)
}
if (!packageJson.bugs?.url?.includes(expectedRepo)) {
  fail(`package.json bugs URL must point at ${expectedRepo}`)
}
if (!packageJson.homepage?.includes(expectedRepo)) {
  fail(`package.json homepage must point at ${expectedRepo}`)
}

const expectedFiles = ['bin', 'dist', 'docs', 'documentation', 'extensions', 'examples', 'CHANGELOG.md', 'QUALITY.md', 'README.md', 'LICENSE']
for (const file of expectedFiles) {
  if (!packageJson.files?.includes(file)) {
    fail(`package.json files is missing ${file}`)
  }
}

const bunfig = read('bunfig.toml')
if (!bunfig.includes(`"MACRO.VERSION" = '"${version}"'`)) {
  fail(`bunfig.toml MACRO.VERSION must be ${version}`)
}
if (bunfig.includes('Maitham16/ur-agent')) {
  fail('bunfig.toml still references Maitham16/ur-agent')
}

const distPath = join(root, 'dist', 'cli.js')
if (!existsSync(distPath)) {
  fail('dist/cli.js is missing; run bun run bundle')
} else {
  const dist = read('dist/cli.js')
  if (!dist.includes(version)) {
    fail(`dist/cli.js does not contain package version ${version}; run bun run bundle`)
  }
  if (dist.includes('1.10.2 (Ur)') || dist.includes('1.10.1 (Ur)')) {
    fail('dist/cli.js still contains an older release version string')
  }
  if (dist.includes('https://github.com/Maitham16/ur-agent')) {
    fail('dist/cli.js still references stale Maitham16/ur-agent public URLs; run bun run bundle')
  }
}

const readme = read('README.md')
const usage = read('docs/USAGE.md')
const config = read('docs/CONFIGURATION.md')
const validation = read('docs/VALIDATION.md')

for (const [path, content] of [
  ['README.md', readme],
  ['docs/USAGE.md', usage],
  ['docs/CONFIGURATION.md', config],
  ['docs/VALIDATION.md', validation],
]) {
  if (content.includes('Maitham16/ur-agent')) {
    fail(`${path} still references Maitham16/ur-agent`)
  }
}

if (readme.includes('falls back to `llama3.2`') || usage.includes('3. `llama3.2`')) {
  fail('docs still describe llama3.2 as the default fallback')
}
if (config.includes('Ollama Cloud, remote model endpoints, and model API keys are not supported')) {
  fail('configuration docs still say Ollama Cloud models are unsupported')
}
if (validation.includes('expected: 1.3.x')) {
  fail('validation docs still contain the stale 1.3.x expected version')
}

try {
  const output = execFileSync('node', ['./bin/ur.js', '--version'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (output !== `${version} (Ur)`) {
    fail(`node ./bin/ur.js --version returned "${output}", expected "${version} (Ur)"`)
  }
} catch (error) {
  fail(`node ./bin/ur.js --version failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (failures.length > 0) {
  console.error('Release check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`Release check passed for UR ${version}.`)
