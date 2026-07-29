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
import { valid as validSemver } from 'semver'

const next = process.argv[2]
const SEMVER_SOURCE =
  String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`
const SEMVER = new RegExp(`^${SEMVER_SOURCE}$`)

if (!next || !SEMVER.test(next) || validSemver(next) === null) {
  console.error('usage: node scripts/version-bump.mjs <version>')
  process.exit(1)
}

/** Top-level "version" only — never dependency ranges. */
const JSON_FILES = [
  { file: 'package.json' },
  { file: 'extensions/vscode-ur-inline-diffs/package.json' },
  {
    file: 'extensions/vscode-ur-inline-diffs/package-lock.json',
    mirrorsRootPackage: true,
  },
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
    pattern: new RegExp(`(class="eyebrow">Version )${SEMVER_SOURCE}(<)`),
  },
  {
    file: 'docs/VALIDATION.md',
    pattern: new RegExp(
      `(# expected for this release: ")${SEMVER_SOURCE}( \\(UR-Nexus\\)")`,
    ),
  },
  // These carry the version as a build-time fallback for MACRO.VERSION.
  {
    file: 'src/commands/agent-ci/agent-ci.ts',
    pattern: new RegExp(`(MACRO\\.VERSION : ')${SEMVER_SOURCE}(')`),
  },
  {
    file: 'src/services/agents/agenticCi.ts',
    pattern: new RegExp(`(MACRO\\.VERSION : ')${SEMVER_SOURCE}(')`),
  },
  {
    file: 'src/services/agents/featureScaffolds.ts',
    pattern: new RegExp(`(MACRO\\.VERSION : ')${SEMVER_SOURCE}(')`),
  },
]

const updates = []
const changed = []

// Read and validate every surface before writing any of them. A missing or
// malformed late file must not leave package.json bumped while the rest of the
// repository is still on the old version.
for (const { file, mirrorsRootPackage = false } of JSON_FILES) {
  const raw = readFileSync(file, 'utf8')
  const data = JSON.parse(raw)
  const before = data.version
  if (
    typeof before !== 'string' ||
    !SEMVER.test(before) ||
    validSemver(before) === null
  ) {
    console.error(`::error::${file} has no valid top-level version`)
    process.exit(1)
  }
  data.version = next
  if (mirrorsRootPackage) {
    const rootVersion = data.packages?.['']?.version
    if (
      typeof rootVersion !== 'string' ||
      !SEMVER.test(rootVersion) ||
      validSemver(rootVersion) === null
    ) {
      console.error(`::error::${file} has no valid packages[""].version`)
      process.exit(1)
    }
    data.packages[''].version = next
  }
  const indent = raw.startsWith('{\n  ') ? 2 : 2
  updates.push({
    file,
    content: `${JSON.stringify(data, null, indent)}\n`,
  })
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
  updates.push({ file, content: raw.replace(pattern, replacement) })
  changed.push(`${file}: -> ${next}`)
}

for (const { file, content } of updates) {
  writeFileSync(file, content)
}

for (const line of changed) console.log(`  ${line}`)
console.log(`\nBumped to ${next}. Dependency ranges untouched by construction.`)
