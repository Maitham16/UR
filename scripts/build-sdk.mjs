#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'sdk')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--skipLibCheck', '--declaration', '--types', 'node', '--outDir', output, join(root, 'src/sdk/index.ts')], { cwd: root, stdio: 'inherit' })
cpSync(join(root, 'src/sdk/README.md'), join(output, 'README.md'))
cpSync(join(root, 'sdk-python'), join(output, 'python'), { recursive: true, filter: path => !relative(join(root, 'sdk-python'), path).split(/[\\/]/).some(part => ['build', 'dist', '__pycache__', 'tests'].includes(part) || part.endsWith('.egg-info')) })
rmSync(join(output, 'python/tests'), { force: true, recursive: true })
console.log('Built dependency-free Node declarations/module and Python SDK source package in sdk/')
