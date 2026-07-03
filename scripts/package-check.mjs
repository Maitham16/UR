#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  missingRequiredPackageFiles,
  releasePathViolations,
  tarballPaths,
} from './release-hygiene.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeBin = process.env.NODE_BIN || 'node'
const bunBin = process.env.BUN_BIN || 'bun'
const failures = []

function fail(message) {
  failures.push(message)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  })
}

function packageSmokeEnv() {
  return {
    ...process.env,
    BUN_BIN: bunBin,
    UR_CODE_SIMPLE: '1',
    UR_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'ur-package-config-')),
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

function packPackage(workDir) {
  const output = execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', workDir, '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_dry_run: 'false',
        npm_config_cache: join(workDir, 'npm-cache'),
      },
    },
  )
  const packed = JSON.parse(output)[0]
  if (!packed?.filename) {
    throw new Error(`npm pack did not report a tarball: ${output}`)
  }
  return join(workDir, packed.filename)
}

function extractPackage(tarball, workDir) {
  const extractDir = join(workDir, 'extract')
  execFileSync('mkdir', ['-p', extractDir])
  execFileSync('tar', ['-xzf', tarball, '-C', extractDir])
  return join(extractDir, 'package')
}

function checkPackageContents(tarball) {
  const paths = tarballPaths(tarball)
  const forbidden = releasePathViolations(paths)
  for (const violation of forbidden) {
    fail(`packed package includes forbidden release artifact: ${violation}`)
  }

  const missing = missingRequiredPackageFiles(paths)
  for (const path of missing) {
    fail(`packed package is missing required runtime file: ${path}`)
  }
}

function runPackagedBin(packageRoot, args) {
  return run(nodeBin, [join(packageRoot, 'bin', 'ur.js'), ...args], {
    cwd: packageRoot,
    env: packageSmokeEnv(),
  })
}

function runPackagedBundle(packageRoot, args) {
  return run(bunBin, [join(packageRoot, 'dist', 'cli.js'), ...args], {
    cwd: packageRoot,
    env: packageSmokeEnv(),
  })
}

function expectStatus(label, result, expectedStatus) {
  if (result.status !== expectedStatus) {
    fail(
      `${label} exited ${result.status}; expected ${expectedStatus}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
}

function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'ur-agent-package-check-'))
  try {
    const tarball = packPackage(workDir)
    checkPackageContents(tarball)
    const packageRoot = extractPackage(tarball, workDir)
    const sourcePackage = readJson(join(root, 'package.json'))
    const packedPackage = readJson(join(packageRoot, 'package.json'))

    if (!packedPackage.engines?.bun) {
      fail('packed package.json is missing engines.bun')
    }
    if (!packedPackage.engines?.node) {
      fail('packed package.json is missing engines.node')
    }
    if (!packedPackage.dependencies?.sharp) {
      fail('packed package.json must declare sharp in dependencies')
    }
    if (packedPackage.devDependencies?.sharp) {
      fail('packed package.json must not declare sharp in devDependencies')
    }

    const version = runPackagedBin(packageRoot, ['--version'])
    expectStatus('packed ur --version', version, 0)
    const expectedVersion = `${sourcePackage.version} (UR-AGENT)`
    if (version.stdout.trim() !== expectedVersion) {
      fail(
        `packed ur --version returned "${version.stdout.trim()}", expected "${expectedVersion}"`,
      )
    }

    const help = runPackagedBin(packageRoot, ['--help'])
    expectStatus('packed ur --help', help, 0)
    if (!help.stdout.includes('Usage: ur')) {
      fail('packed ur --help did not print CLI usage')
    }

    const doctor = runPackagedBin(packageRoot, ['doctor', '--help'])
    expectStatus('packed ur doctor --help', doctor, 0)
    if (!doctor.stdout.includes('Usage: ur doctor')) {
      fail('packed ur doctor --help did not print doctor usage')
    }

    const providerDoctor = runPackagedBundle(packageRoot, [
      'provider',
      'doctor',
      'openai-api',
      '--json',
    ])
    expectStatus('packed provider missing-key check', providerDoctor, 1)
    try {
      if (!providerDoctor.stdout.trim()) {
        throw new Error(`stdout was empty; stderr:\n${providerDoctor.stderr}`)
      }
      const body = JSON.parse(providerDoctor.stdout)
      if (body.failureReason !== 'API key missing') {
        fail(
          `packed provider doctor returned failureReason ${JSON.stringify(body.failureReason)}`,
        )
      }
      if (!String(body.suggestedFix ?? '').includes('OPENAI_API_KEY')) {
        fail('packed provider doctor missing-key fix does not mention OPENAI_API_KEY')
      }
    } catch (error) {
      fail(
        `packed provider doctor did not return JSON: ${
          error instanceof Error ? error.message : String(error)
        }\nstdout:\n${providerDoctor.stdout}`,
      )
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    console.error('Package check failed:')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('Package check passed: tarball builds and shipped CLI starts.')
}

main()
