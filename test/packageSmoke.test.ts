import { describe, expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..')
const nodeBin = process.env.NODE_BIN || 'node'
const bunBin = process.env.BUN_BIN || process.execPath

function readPackageJson(path = repoRoot) {
  return JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
}

function packageSmokeEnv(temporaryRoot: string) {
  return {
    ...process.env,
    BUN_BIN: bunBin,
    UR_CODE_SIMPLE: '1',
    UR_CONFIG_DIR: mkdtempSync(join(temporaryRoot, '.ur-package-config-')),
    URHQ_API_KEY: '',
    URHQ_AUTH_TOKEN: '',
    URHQ_UNIX_SOCKET: '',
    UR_CODE_OAUTH_TOKEN: '',
    UR_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
    OPENROUTER_API_KEY: '',
  }
}

function packAndExtract(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-package-smoke-'))
  const packOutput = execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', tmp, '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: join(tmp, 'npm-cache'),
      },
    },
  )

  const payload = parsePackPayload(extractJsonPayload(packOutput))
  if (!payload.filename) {
    throw new Error(`npm pack --json returned no filename:\n${packOutput}`)
  }

  const tarball = join(tmp, payload.filename)
  const extractDir = join(tmp, 'extract')
  execFileSync('mkdir', ['-p', extractDir])
  execFileSync('tar', ['-xzf', tarball, '-C', extractDir])
  return join(extractDir, 'package')
}

function extractJsonPayload(text: string): unknown {
  const starts = Array.from(text).flatMap((char, index) =>
    char === '{' || char === '[' ? [index] : [],
  )
  for (const start of starts) {
    const parsed = extractJsonAt(text, start)
    if (parsed !== undefined) return parsed
  }
  throw new Error(`npm pack --json produced no parseable JSON payload:\n${text}`)
}

function extractJsonAt(text: string, index: number): unknown {
  if (text[index] !== '{' && text[index] !== '[') return undefined
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = index; i < text.length; i++) {
    const char = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{' || char === '[') {
      depth++
      continue
    }
    if (char === '}' || char === ']') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(index, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

function parsePackPayload(parsed: unknown): { filename: string } {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { filename: '' }
    const first = parsed[0]
    return isPackRecord(first) ? first : { filename: '' }
  }
  if (isPackRecord(parsed)) return parsed

  if (isPlainObject(parsed)) {
    for (const candidate of Object.values(parsed)) {
      if (isPackRecord(candidate)) return candidate
    }
  }

  return { filename: '' }
}

function isPackRecord(value: unknown): value is { filename: string } {
  return isPlainObject(value) && typeof value.filename === 'string'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function runPackagedBin(packageRoot: string, args: string[]) {
  return spawnSync(nodeBin, [join(packageRoot, 'bin', 'ur.js'), ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: packageSmokeEnv(packageRoot),
  })
}

function runPackagedBundle(packageRoot: string, args: string[]) {
  return spawnSync(bunBin, [join(packageRoot, 'dist', 'cli.js'), ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: packageSmokeEnv(packageRoot),
  })
}

describe('package runtime contract', () => {
  test('package metadata declares Bun runtime and sharp runtime dependency', () => {
    const pkg = readPackageJson()
    expect(pkg.packageManager).toStartWith('bun@')
    expect(pkg.engines?.node).toBeDefined()
    expect(pkg.engines?.bun).toBeDefined()
    expect(pkg.dependencies?.sharp).toBeDefined()
    expect(pkg.devDependencies?.sharp).toBeUndefined()
  })

  test('launcher reports a precise missing-Bun runtime error', () => {
    const result = spawnSync(nodeBin, [join(repoRoot, 'bin', 'ur.js'), '--version'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        BUN_BIN: join(tmpdir(), 'ur-missing-bun'),
      },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('UR-Nexus requires Bun')
    expect(result.stderr).toContain('Bun >=1.3')
    expect(result.stderr).toContain('BUN_BIN')
  })

  test('launcher rejects a prerelease Bun below the stable engine minimum', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ur-old-bun-'))
    try {
      const oldBun = join(tmp, 'bun')
      writeFileSync(
        oldBun,
        [
          '#!/usr/bin/env node',
          "if (process.argv[2] === '--version') {",
          "  process.stdout.write('1.3.0-beta.1\\n')",
          '  process.exit(0)',
          '}',
          'process.exit(99)',
          '',
        ].join('\n'),
      )
      chmodSync(oldBun, 0o755)

      const result = spawnSync(
        nodeBin,
        [join(repoRoot, 'bin', 'ur.js'), '--version'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            BUN_BIN: oldBun,
          },
        },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Found Bun 1.3.0-beta.1')
      expect(result.stderr).toContain('engines.bun ">=1.3.0"')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('packed package CLI starts and reports missing API key cleanly', () => {
    const packageRoot = packAndExtract()
    try {
      const pkg = readPackageJson(packageRoot)

      const version = runPackagedBin(packageRoot, ['--version'])
      expect(version.status).toBe(0)
      expect(version.stdout.trim()).toBe(`${pkg.version} (UR-Nexus)`)

      const help = runPackagedBin(packageRoot, ['--help'])
      expect(help.status).toBe(0)
      expect(help.stdout).toContain('Usage: ur')

      const doctorHelp = runPackagedBin(packageRoot, ['doctor', '--help'])
      expect(doctorHelp.status).toBe(0)
      expect(doctorHelp.stdout).toContain('Usage: ur doctor')

      const providerDoctor = runPackagedBundle(packageRoot, [
        'provider',
        'doctor',
        'openai-api',
        '--json',
      ])
      expect(providerDoctor.status).toBe(1)
      if (!providerDoctor.stdout.trim()) {
        throw new Error(
          `provider doctor produced no JSON on stdout\nstderr:\n${providerDoctor.stderr}`,
        )
      }
      const body = JSON.parse(providerDoctor.stdout)
      expect(body.failureReason).toBe('API key missing')
      expect(body.suggestedFix).toContain('OPENAI_API_KEY')

      expect(pkg.dependencies?.sharp).toBeDefined()
    } finally {
      // packageRoot is <temporary>/extract/package. Resolve through parent
      // directories instead of splitting on a POSIX-only path fragment.
      rmSync(join(packageRoot, '..', '..'), {
        recursive: true,
        force: true,
      })
    }
  }, 30_000)
})
