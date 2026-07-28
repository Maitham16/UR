#!/usr/bin/env node
/**
 * Bump the version across every surface that carries it.
 *
 * This exists because bumping with `sed 's/OLD/NEW/g' package.json` silently
 * rewrote a *dependency* that happened to sit at the same version as UR:
 * `playwright-core: ^1.61.1` became `^1.61.2`, then cascaded to `^1.64.0`,
 * a version that does not exist. Releases 1.61.2 through 1.64.0 were
 * uninstallable from npm as a result, and nothing caught it because the built
 * artifact and every test were fine — only `npm install` failed, on other
 * people's machines.
 *
 * So: JSON files are edited as JSON, touching only the top-level `version`
 * key. Text files use anchored patterns that cannot match a dependency range.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const next = process.argv[2]
if (!next || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
  console.error('usage: node scripts/version-bump.mjs <version>')
  process.exit(1)
}

/** Top-level "version" only — never dependency ranges. */
const JSON_FILES = [
  'package.json',
  'extensions/vscode-ur-inline-diffs/package.json',
  'extensions/vscode-ur-inline-diffs/package-lock.json',
]

/**
 * Anchored so the pattern describes the *line* carrying the version, not the
 * bare number. A pattern that matches a loose version string anywhere is what
 * caused the incident this script prevents.
 */
const TEXT_FILES = [
  { file: 'bunfig.toml', pattern: /("MACRO\.VERSION" = ')"[^"]+"(')/ },
  { file: 'extensions/jetbrains-ur/build.gradle.kts', pattern: /(^version = ")[^"]+(")/m },
  {
    file: 'documentation/index.html',
    pattern: /(class="eyebrow">Version )\d+\.\d+\.\d+(<)/,
  },
  // These carry the version as a build-time fallback for MACRO.VERSION.
  {
    file: 'src/commands/agent-ci/agent-ci.ts',
    pattern: /(MACRO\.VERSION : ')\d+\.\d+\.\d+(')/,
  },
  {
    file: 'src/services/agents/agenticCi.ts',
    pattern: /(MACRO\.VERSION : ')\d+\.\d+\.\d+(')/,
  },
  {
    file: 'src/services/agents/featureScaffolds.ts',
    pattern: /(MACRO\.VERSION : ')\d+\.\d+\.\d+(')/,
  },
]

const changed = []

for (const file of JSON_FILES) {
  const raw = readFileSync(file, 'utf8')
  const data = JSON.parse(raw)
  const before = data.version
  data.version = next
  // package-lock mirrors the version in the root package entry too.
  if (data.packages?.['']?.version) data.packages[''].version = next
  const indent = raw.startsWith('{\n  ') ? 2 : 2
  writeFileSync(file, `${JSON.stringify(data, null, indent)}\n`)
  changed.push(`${file}: ${before} -> ${next}`)
}

for (const { file, pattern } of TEXT_FILES) {
  const raw = readFileSync(file, 'utf8')
  if (!pattern.test(raw)) {
    console.error(`::error::${file} has no version line matching ${pattern}`)
    process.exit(1)
  }
  const replacement =
    file === 'bunfig.toml' ? `$1"${next}"$2` : `$1${next}$2`
  writeFileSync(file, raw.replace(pattern, replacement))
  changed.push(`${file}: -> ${next}`)
}

for (const line of changed) console.log(`  ${line}`)
console.log(`\nBumped to ${next}. Dependency ranges untouched by construction.`)
