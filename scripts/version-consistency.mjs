import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const VERSION_FALLBACK_FILES = [
  'src/commands/agent-ci/agent-ci.ts',
  'src/services/agents/agenticCi.ts',
  'src/services/agents/featureScaffolds.ts',
  'src/services/agents/trends.ts',
]

function read(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

function readJson(root, path, errors) {
  try {
    return JSON.parse(read(root, path))
  } catch (error) {
    errors.push(
      `${path} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/**
 * Validate every source surface that must agree before a release bundle is
 * built. dist/cli.js is deliberately excluded: it is the output produced
 * after this preflight succeeds.
 */
export function collectVersionConsistencyErrors(root, expectedVersion) {
  const errors = []
  const packageJson = readJson(root, 'package.json', errors)
  const vscodePackage = readJson(
    root,
    'extensions/vscode-ur-inline-diffs/package.json',
    errors,
  )
  const vscodeLock = readJson(
    root,
    'extensions/vscode-ur-inline-diffs/package-lock.json',
    errors,
  )

  if (packageJson?.version !== expectedVersion) {
    errors.push(`package.json version must be ${expectedVersion}`)
  }
  if (vscodePackage?.version !== expectedVersion) {
    errors.push(
      `extensions/vscode-ur-inline-diffs/package.json version must be ${expectedVersion}`,
    )
  }
  if (
    vscodeLock?.version !== expectedVersion ||
    vscodeLock?.packages?.['']?.version !== expectedVersion
  ) {
    errors.push(
      `extensions/vscode-ur-inline-diffs/package-lock.json root versions must both be ${expectedVersion}`,
    )
  }

  const requiredText = [
    {
      path: 'bunfig.toml',
      needle: `"MACRO.VERSION" = '"${expectedVersion}"'`,
      label: 'MACRO.VERSION',
    },
    {
      path: 'extensions/jetbrains-ur/build.gradle.kts',
      needle: `version = "${expectedVersion}"`,
      label: 'plugin version',
    },
    {
      path: 'documentation/index.html',
      needle: `Version ${expectedVersion}`,
      label: 'version eyebrow',
    },
    {
      path: 'docs/VALIDATION.md',
      needle: `# expected for this release: "${expectedVersion} (UR-Nexus)"`,
      label: 'smoke-test version',
    },
    {
      path: 'CHANGELOG.md',
      needle: `## ${expectedVersion}`,
      label: 'release entry',
    },
  ]

  for (const { path, needle, label } of requiredText) {
    try {
      if (!read(root, path).includes(needle)) {
        errors.push(`${path} ${label} must be ${expectedVersion}`)
      }
    } catch (error) {
      errors.push(
        `${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  for (const path of VERSION_FALLBACK_FILES) {
    try {
      if (!read(root, path).includes(`MACRO.VERSION : '${expectedVersion}'`)) {
        errors.push(`${path} MACRO.VERSION fallback must be ${expectedVersion}`)
      }
    } catch (error) {
      errors.push(
        `${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return errors
}

export function assertVersionConsistency(root, expectedVersion) {
  const errors = collectVersionConsistencyErrors(root, expectedVersion)
  if (errors.length === 0) return

  throw new Error(
    [
      `Version surfaces are inconsistent for ${expectedVersion}.`,
      ...errors.map(error => `- ${error}`),
      `Run \`node scripts/version-bump.mjs ${expectedVersion}\`, add the CHANGELOG entry, then build again.`,
    ].join('\n'),
  )
}
