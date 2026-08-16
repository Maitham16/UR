import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compare } from 'semver'

const REPO = join(import.meta.dir, '..')

test('GitHub production checks run only after the test step succeeds', () => {
  const workflow = readFileSync(
    join(REPO, '.github', 'workflows', 'test.yml'),
    'utf8',
  )

  const tests = workflow.indexOf('name: Run tests (Bun)')
  const install = workflow.indexOf('name: Install dependencies (Bun)')
  const dependencyAudit = workflow.indexOf('name: Dependency audit')
  const typecheck = workflow.indexOf('name: Typecheck')
  const lint = workflow.indexOf('name: Lint')
  const bundle = workflow.indexOf('name: Build bundle')
  const smoke = workflow.indexOf('name: Smoke test')
  const secretScan = workflow.indexOf('name: Secret scan')
  const release = workflow.indexOf('name: Release check')
  const pkg = workflow.indexOf('name: Package Check')
  const globalInstall = workflow.indexOf('name: Test Global Install (NPM)')

  expect(tests).toBeGreaterThan(-1)
  expect(install).toBeGreaterThan(-1)
  expect(dependencyAudit).toBeGreaterThan(install)
  expect(dependencyAudit).toBeLessThan(tests)
  expect(typecheck).toBeGreaterThan(dependencyAudit)
  expect(lint).toBeGreaterThan(typecheck)
  expect(lint).toBeLessThan(tests)
  for (const step of [bundle, release, pkg, globalInstall]) {
    expect(step).toBeGreaterThan(tests)
  }

  expect(workflow).toContain('bun test --timeout 120000 2>&1')
  expect(workflow).not.toContain('--parallel=4')
  expect(workflow).toContain('bun ci')
  expect(workflow).toContain('bun run dependencies:audit')
  expect(workflow).toContain('bun run lint')
  expect(workflow).toContain('name: Build bundle\n        if: success()')
  expect(workflow).toContain('name: Smoke test\n        if: success()')
  expect(workflow).toContain('name: Secret scan\n        if: success()')
  expect(workflow).toContain('name: Release check\n        if: success()')
  expect(workflow).toContain('name: Package Check\n        if: success()')
  expect(workflow).toContain('name: Test Global Install (NPM)\n        if: success()')
  expect(workflow).toContain('permissions:\n  contents: read')
  expect(workflow).toContain('npm audit --audit-level=high')
  expect(workflow).toContain(
    'gradle --no-daemon buildPlugin verifyPluginConfiguration verifyPlugin',
  )

  const actionReferences = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g)]
  expect(actionReferences.length).toBeGreaterThan(0)
  for (const [, reference] of actionReferences) {
    expect(reference).toMatch(/^[0-9a-f]{40}$/)
  }
})

test('release gate audits the Bun lockfile used by shipped builds', () => {
  const packageJson = JSON.parse(
    readFileSync(join(REPO, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> }
  const releaseCheck = readFileSync(
    join(REPO, 'scripts', 'release-check.mjs'),
    'utf8',
  )

  expect(packageJson.scripts?.['dependencies:audit']).toBe('bun audit')
  expect(releaseCheck).toContain("execFileSync('bun', ['audit']")
})

test('development and release bundles ship the core Explore and Plan registry', () => {
  const bundle = readFileSync(join(REPO, 'scripts', 'bundle.mjs'), 'utf8')
  const developmentPlugin = readFileSync(
    join(REPO, 'plugins', 'bunBundleDev.ts'),
    'utf8',
  )
  const registry = readFileSync(
    join(REPO, 'src', 'tools', 'AgentTool', 'builtInAgents.ts'),
    'utf8',
  )

  expect(bundle).toContain("'--feature=BUILTIN_EXPLORE_PLAN_AGENTS'")
  expect(bundle).toContain(
    'dist/cli.js does not ship the core Explore/Plan agent registry',
  )
  expect(developmentPlugin).toContain("'BUILTIN_EXPLORE_PLAN_AGENTS'")
  expect(registry).toContain("process.env.USER_TYPE !== 'ant'")
  expect(registry).toContain('agents.push(EXPLORE_AGENT, PLAN_AGENT)')
})

test('strict-core cannot report unchecked files as type-safe', () => {
  const strictConfig = JSON.parse(
    readFileSync(join(REPO, 'tsconfig.strict-core.json'), 'utf8'),
  ) as { files: string[] }
  const uncheckedFiles = strictConfig.files.filter(file =>
    /^\s*\/\/\s*@ts-nocheck\b/m.test(
      readFileSync(join(REPO, file), 'utf8'),
    ),
  )
  const strictCheck = readFileSync(
    join(REPO, 'scripts', 'strict-core-check.mjs'),
    'utf8',
  )

  expect(uncheckedFiles).toEqual([])
  expect(strictCheck).toContain('Strict core typecheck cannot include @ts-nocheck files')
})

test('release gate keeps npm, documentation, and IDE versions synchronized', () => {
  const releaseCheck = readFileSync(
    join(REPO, 'scripts', 'release-check.mjs'),
    'utf8',
  )

  expect(releaseCheck).toContain(
    "read('extensions/vscode-ur-inline-diffs/package.json')",
  )
  expect(releaseCheck).toContain(
    "read('extensions/vscode-ur-inline-diffs/package-lock.json')",
  )
  expect(releaseCheck).toContain(
    "read('extensions/jetbrains-ur/build.gradle.kts')",
  )
  expect(releaseCheck).toContain("read('documentation/index.html')")
  expect(releaseCheck).toContain(
    "`# expected for this release: \"${version} (UR-Nexus)\"`",
  )
  expect(releaseCheck).toContain(
    "'src/commands/agent-ci/agent-ci.ts'",
  )
  expect(releaseCheck).toContain(
    "'src/services/agents/agenticCi.ts'",
  )
  expect(releaseCheck).toContain(
    "'src/services/agents/featureScaffolds.ts'",
  )
})

test('changelog starts at the package version and remains newest-first', () => {
  const packageJson = JSON.parse(
    readFileSync(join(REPO, 'package.json'), 'utf8'),
  ) as { version: string }
  const changelog = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8')
  const versions = [...changelog.matchAll(/^## (\S+)$/gm)].map(
    match => match[1]!,
  )

  expect(versions[0]).toBe(packageJson.version)
  for (let index = 1; index < versions.length; index += 1) {
    const newer = versions[index - 1]!
    const older = versions[index]!
    expect(compare(newer, older), `${newer} must precede ${older}`).toBeGreaterThan(0)
  }
})

test('release workflow downloads artifacts with permission and keeps prereleases off latest', () => {
  const workflow = readFileSync(
    join(REPO, '.github', 'workflows', 'release.yml'),
    'utf8',
  )
  const githubRelease = workflow.slice(
    workflow.indexOf('  github-release:'),
    workflow.indexOf('  npm-publish:'),
  )
  const npmPublish = workflow.slice(workflow.indexOf('  npm-publish:'))

  expect(workflow).not.toContain('  publish-preflight:')
  expect(githubRelease).toContain('needs: [verify, npm-publish]')
  expect(npmPublish).toContain('needs: verify')
  expect(npmPublish).toContain('id-token: write')
  expect(npmPublish).not.toContain('NODE_AUTH_TOKEN')
  expect(npmPublish).not.toContain('secrets.NPM_TOKEN')
  expect(npmPublish).toContain('ACTIONS_ID_TOKEN_REQUEST_URL')
  expect(npmPublish).toContain('ACTIONS_ID_TOKEN_REQUEST_TOKEN')
  expect(npmPublish).toContain(
    'npm publish ./dist-release/ur-agent-"$VERSION".tgz',
  )
  expect(npmPublish).not.toContain(
    'npm publish dist-release/ur-agent-"$VERSION".tgz',
  )
  expect(githubRelease).toContain('actions: read')
  expect(npmPublish).toContain('actions: read')
  expect(workflow).toContain('npm_tag=latest')
  expect(workflow).toContain('npm_tag=next')
  expect(workflow).toContain('--prerelease="$PRERELEASE"')
  expect(workflow).toContain('--tag "$NPM_TAG"')
  expect(workflow).toContain('bun test --timeout 120000')
  expect(workflow).not.toContain('--parallel=4')
  expect(workflow).toContain("bun run release:tag -- --push")
})

test('active checkout excludes superseded release evidence and design leftovers', () => {
  const packageJson = JSON.parse(
    readFileSync(join(REPO, 'package.json'), 'utf8'),
  ) as { version: string }
  const obsoletePaths = [
    'AUDIT-1.73.0.md',
    'IDE_INTEGRATION_ARCHITECTURE.md',
    'benchmarks/results/1.37.2',
  ]

  for (const relativePath of obsoletePaths) {
    expect(existsSync(join(REPO, relativePath)), relativePath).toBe(false)
  }

  const resultVersions = readdirSync(join(REPO, 'benchmarks', 'results'), {
    withFileTypes: true,
  })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  const staleVersions = resultVersions.filter(
    version => version !== packageJson.version,
  )
  expect(
    staleVersions,
    `benchmark evidence must match ${packageJson.version}; stale directories: ${staleVersions.join(', ') || 'none'}`,
  ).toEqual([])
})

test('package smoke configurations are cleaned with the package-check work directory', () => {
  const packageCheck = readFileSync(
    join(REPO, 'scripts', 'package-check.mjs'),
    'utf8',
  )

  expect(packageCheck).toContain(
    "mkdtempSync(join(temporaryRoot, '.ur-package-config-'))",
  )
  expect(packageCheck).not.toContain(
    "mkdtempSync(join(tmpdir(), 'ur-package-config-'))",
  )
})

test('Dependabot monitors every shipped dependency ecosystem', () => {
  const dependabot = readFileSync(
    join(REPO, '.github', 'dependabot.yml'),
    'utf8',
  )

  expect(dependabot).toContain('package-ecosystem: bun')
  expect(dependabot).toContain('package-ecosystem: github-actions')
  expect(dependabot).toContain('package-ecosystem: npm')
  expect(dependabot).toContain('/extensions/vscode-ur-inline-diffs')
  expect(dependabot).toContain('package-ecosystem: gradle')
  expect(dependabot).toContain('/extensions/jetbrains-ur')
  expect(dependabot).toContain('exclude-patterns:')
  expect(dependabot).toContain('dependency-name: "@alcalzone/ansi-tokenize"')
  expect(dependabot).toContain('dependency-name: "@types/react"')
  expect(dependabot).toContain('dependency-name: "@types/react-reconciler"')
})

test('A2A fast startup preserves every advertised authentication option', () => {
  const source = readFileSync('src/entrypoints/cli.tsx', 'utf8')
  expect(source).toContain("delegationSecret: valueAfter('--delegation-secret')")
  expect(source).toContain("audience: valueAfter('--audience', 'ur-nexus')")
})
