#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entrypoint = resolve(packageRoot, 'src/entrypoints/cli.tsx')
const bundledEntrypoint = resolve(packageRoot, 'dist/cli.js')
const preload = resolve(packageRoot, 'plugins/bunBundleDev.ts')
const packageJsonPath = resolve(packageRoot, 'package.json')

function readPackageMetadata() {
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch {
    return {}
  }
}

function defineMacro(name, value) {
  return `${name}=${value === undefined ? 'undefined' : JSON.stringify(value)}`
}

const packageMetadata = readPackageMetadata()
const version =
  typeof packageMetadata.version === 'string'
    ? packageMetadata.version
    : '0.0.0-dev'
const packageName =
  typeof packageMetadata.name === 'string' ? packageMetadata.name : 'ur-nexus'
const issuesUrl =
  typeof packageMetadata.bugs?.url === 'string'
    ? packageMetadata.bugs.url
    : 'https://github.com/Maitham16/UR/issues'

const bun = process.env.BUN_BIN || process.env.BUN_EXECUTABLE || 'bun'
const ollamaModel =
  process.env.OLLAMA_MODEL || process.env.UR_MODEL
const userArgs = process.argv.slice(2)
const requiredBun =
  typeof packageMetadata.engines?.bun === 'string'
    ? packageMetadata.engines.bun
    : '>=1.3.0'

function printBunRuntimeError(detail) {
  const attempted = bun
  const source =
    process.env.BUN_BIN
      ? 'BUN_BIN'
      : process.env.BUN_EXECUTABLE
        ? 'BUN_EXECUTABLE'
        : 'PATH'
  console.error(
    [
      `UR-Nexus requires Bun ${requiredBun} at runtime because the published CLI bundle is built with --target bun.`,
      `Bun executable: "${attempted}" (resolved from ${source}).`,
      detail,
      'Install Bun from https://bun.sh, or set BUN_BIN to the absolute path of a Bun executable.',
    ].filter(Boolean).join('\n'),
  )
}

function parseSemver(value) {
  const match = value.match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  )
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] > right.core[index] ? 1 : -1
    }
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) > Number(rightPart) ? 1 : -1
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

function satisfiesBunEngine(version, range) {
  const actual = parseSemver(version)
  const minimumMatch = range.trim().match(/^>=\s*(.+)$/)
  const minimum = minimumMatch ? parseSemver(minimumMatch[1]) : null
  if (!actual || !minimum) return null
  return compareSemver(actual, minimum) >= 0
}

function assertBunAvailable() {
  const result = spawnSync(bun, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error) {
    printBunRuntimeError(`Could not execute Bun: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    printBunRuntimeError(
      detail
        ? `Bun --version failed: ${detail}`
        : `Bun --version exited with status ${result.status}.`,
    )
    process.exit(result.status ?? 1)
  }

  const installedBun = result.stdout.trim()
  const satisfies = satisfiesBunEngine(installedBun, requiredBun)
  if (satisfies === null) {
    printBunRuntimeError(
      `Could not validate Bun version "${installedBun}" against engines.bun "${requiredBun}".`,
    )
    process.exit(1)
  }
  if (!satisfies) {
    printBunRuntimeError(
      `Found Bun ${installedBun}, which does not satisfy engines.bun "${requiredBun}".`,
    )
    process.exit(1)
  }
}

const args =
  existsSync(bundledEntrypoint)
    ? [bundledEntrypoint, ...userArgs]
    : [
        'run',
        '--preload',
        preload,
        '--define',
        defineMacro('MACRO.VERSION', version),
        '--define',
        defineMacro('MACRO.BUILD_TIME', ''),
        '--define',
        defineMacro('MACRO.PACKAGE_URL', packageName),
        '--define',
        defineMacro('MACRO.NATIVE_PACKAGE_URL', undefined),
        '--define',
        defineMacro('MACRO.FEEDBACK_CHANNEL', issuesUrl),
        '--define',
        defineMacro('MACRO.ISSUES_EXPLAINER', `file an issue at ${issuesUrl}`),
        '--define',
        defineMacro('MACRO.VERSION_CHANGELOG', ''),
        entrypoint,
        ...userArgs,
      ]

assertBunAvailable()

const shouldPipeChildOutput = !process.stdout.isTTY || !process.stderr.isTTY
const child = spawn(bun, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...(ollamaModel ? { OLLAMA_MODEL: ollamaModel } : {}),
  },
  stdio: shouldPipeChildOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
})

if (shouldPipeChildOutput) {
  child.stdout?.on('data', chunk => {
    forwardChildOutput(child.stdout, process.stdout, chunk)
  })
  child.stderr?.on('data', chunk => {
    forwardChildOutput(child.stderr, process.stderr, chunk)
  })
}

function forwardChildOutput(source, target, chunk) {
  try {
    const canContinue = target.write(chunk)
    if (!canContinue) {
      source.pause()
      target.once('drain', () => source.resume())
    }
  } catch (error) {
    if (isRetryableWriteError(error)) {
      source.pause()
      setTimeout(() => {
        if (target.destroyed) return
        try {
          const canContinue = target.write(chunk)
          if (canContinue) source.resume()
          else target.once('drain', () => source.resume())
        } catch (retryError) {
          if (isRetryableWriteError(retryError)) {
            forwardChildOutput(source, target, chunk)
            return
          }
          if (!isBrokenPipe(retryError)) {
            try {
              process.stderr.write(`UR launcher output forwarding failed: ${retryError.message ?? String(retryError)}\n`)
            } catch {
              // Nothing sensible remains if stderr itself is unavailable.
            }
          }
        }
      }, 10)
      return
    }
    if (isBrokenPipe(error)) {
      source.destroy?.()
      return
    }
    try {
      process.stderr.write(`UR launcher output forwarding failed: ${error.message ?? String(error)}\n`)
    } catch {
      // Nothing sensible remains if stderr itself is unavailable.
    }
  }
}

function isRetryableWriteError(error) {
  return error && (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK')
}

function isBrokenPipe(error) {
  return error && error.code === 'EPIPE'
}

child.on('error', error => {
  if (error.code === 'ENOENT') {
    printBunRuntimeError(error.message)
    process.exit(1)
  }

  console.error(error.message)
  process.exit(1)
})

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exitCode = code ?? 1
})
