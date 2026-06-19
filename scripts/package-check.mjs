#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(tmpdir(), 'ur-agent-npm-cache')

mkdirSync(cacheDir, { recursive: true })

execFileSync('npm', ['pack', '--dry-run'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_cache: cacheDir,
  },
})
