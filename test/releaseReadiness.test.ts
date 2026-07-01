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
  const bundle = workflow.indexOf('name: Build bundle')
  const release = workflow.indexOf('name: Release check')
  const pkg = workflow.indexOf('name: Package Check')
  const globalInstall = workflow.indexOf('name: Test Global Install (NPM)')

  expect(tests).toBeGreaterThan(-1)
  for (const step of [bundle, release, pkg, globalInstall]) {
    expect(step).toBeGreaterThan(tests)
  }

  expect(workflow).toContain('bun test --timeout 120000')
  expect(workflow).toContain('name: Build bundle\n        if: success()')
  expect(workflow).toContain('name: Release check\n        if: success()')
  expect(workflow).toContain('name: Package Check\n        if: success()')
  expect(workflow).toContain('name: Test Global Install (NPM)\n        if: success()')
})
