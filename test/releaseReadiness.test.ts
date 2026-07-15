import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

  expect(workflow).toContain('bun test --timeout 120000')
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
})

test('A2A fast startup preserves every advertised authentication option', () => {
  const source = readFileSync('src/entrypoints/cli.tsx', 'utf8')
  expect(source).toContain("delegationSecret: valueAfter('--delegation-secret')")
  expect(source).toContain("audience: valueAfter('--audience', 'ur-nexus')")
})
