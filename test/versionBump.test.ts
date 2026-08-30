import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const REPO = join(import.meta.dir, '..')
const SCRIPT = join(REPO, 'scripts', 'version-bump.mjs')

function writeFixture(root: string, version: string): void {
  const jsonFiles: Record<string, unknown> = {
    'package.json': {
      name: 'fixture',
      version,
      dependencies: { 'playwright-core': '^1.61.1' },
    },
    'extensions/vscode-ur-inline-diffs/package.json': {
      name: 'fixture-extension',
      version,
    },
    'extensions/vscode-ur-inline-diffs/package-lock.json': {
      name: 'fixture-extension',
      version,
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture-extension', version },
      },
    },
  }
  const textFiles: Record<string, string> = {
    'bunfig.toml': `"MACRO.VERSION" = '"${version}"'\n`,
    'extensions/jetbrains-ur/build.gradle.kts': `version = "${version}"\n`,
    'documentation/index.html': `<p class="eyebrow">Version ${version}</p>\n`,
    'docs/VALIDATION.md':
      `# expected for this release: "${version} (UR-Nexus)"\n`,
    'src/commands/agent-ci/agent-ci.ts':
      `return typeof MACRO !== 'undefined' ? MACRO.VERSION : '${version}'\n`,
    'src/services/agents/agenticCi.ts':
      `typeof MACRO !== 'undefined' ? MACRO.VERSION : '${version}'\n`,
    'src/services/agents/featureScaffolds.ts':
      `typeof MACRO !== 'undefined' ? MACRO.VERSION : '${version}'\n`,
    'src/services/agents/trends.ts':
      `typeof MACRO !== 'undefined' ? MACRO.VERSION : '${version}'\n`,
  }

  for (const [path, value] of Object.entries(jsonFiles)) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`)
  }
  for (const [path, value] of Object.entries(textFiles)) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, value)
  }
}

test('version bump moves every surface from one prerelease to another', () => {
  const root = mkdtempSync(join(tmpdir(), 'ur-version-bump-'))
  try {
    writeFixture(root, '2.0.0-beta.1')
    const result = spawnSync(
      'node',
      [SCRIPT, '2.0.0-beta.2'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.status, result.stderr).toBe(0)

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.version).toBe('2.0.0-beta.2')
    expect(pkg.dependencies['playwright-core']).toBe('^1.61.1')

    const extension = JSON.parse(
      readFileSync(
        join(root, 'extensions/vscode-ur-inline-diffs/package.json'),
        'utf8',
      ),
    )
    const lock = JSON.parse(
      readFileSync(
        join(root, 'extensions/vscode-ur-inline-diffs/package-lock.json'),
        'utf8',
      ),
    )
    expect(extension.version).toBe('2.0.0-beta.2')
    expect(lock.version).toBe('2.0.0-beta.2')
    expect(lock.packages[''].version).toBe('2.0.0-beta.2')

    for (const path of [
      'bunfig.toml',
      'extensions/jetbrains-ur/build.gradle.kts',
      'documentation/index.html',
      'docs/VALIDATION.md',
      'src/commands/agent-ci/agent-ci.ts',
      'src/services/agents/agenticCi.ts',
      'src/services/agents/featureScaffolds.ts',
      'src/services/agents/trends.ts',
    ]) {
      expect(readFileSync(join(root, path), 'utf8'), path).toContain(
        '2.0.0-beta.2',
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('version bump validates every surface before changing package.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'ur-version-bump-'))
  try {
    writeFixture(root, '2.0.0')
    const packageBefore = readFileSync(join(root, 'package.json'), 'utf8')
    writeFileSync(
      join(root, 'src/services/agents/featureScaffolds.ts'),
      '// missing version fallback\n',
    )

    const result = spawnSync(
      'node',
      [SCRIPT, '2.0.1'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'src/services/agents/featureScaffolds.ts has no version line',
    )
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageBefore)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('version bump rejects strings that look semver-like but npm cannot publish', () => {
  const root = mkdtempSync(join(tmpdir(), 'ur-version-bump-'))
  try {
    writeFixture(root, '2.0.0')
    const packageBefore = readFileSync(join(root, 'package.json'), 'utf8')

    for (const invalid of [
      '01.2.3',
      '1.02.3',
      '1.2.03',
      '1.2.3-01',
      '1.2.3-alpha..1',
    ]) {
      const result = spawnSync('node', [SCRIPT, invalid], {
        cwd: root,
        encoding: 'utf8',
      })
      expect(result.status, invalid).toBe(1)
      expect(result.stderr, invalid).toContain(
        'usage: node scripts/version-bump.mjs <version>',
      )
      expect(readFileSync(join(root, 'package.json'), 'utf8'), invalid).toBe(
        packageBefore,
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
