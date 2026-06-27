#!/usr/bin/env node
import { spawn } from 'node:child_process'
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
  typeof packageMetadata.name === 'string' ? packageMetadata.name : 'ur-agent'
const issuesUrl =
  typeof packageMetadata.bugs?.url === 'string'
    ? packageMetadata.bugs.url
    : 'https://github.com/Maitham16/UR-mapek/issues'

const bun = process.env.BUN_BIN || process.env.BUN_EXECUTABLE || 'bun'
const ollamaModel =
  process.env.OLLAMA_MODEL || process.env.UR_MODEL
const userArgs = process.argv.slice(2)
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

const child = spawn(bun, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...(ollamaModel ? { OLLAMA_MODEL: ollamaModel } : {}),
  },
  stdio: 'inherit',
})

child.on('error', error => {
  if (error.code === 'ENOENT') {
    console.error(
      'Ur requires Bun to run. Install Bun from https://bun.sh, then retry.',
    )
    process.exit(1)
  }

  console.error(error.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
