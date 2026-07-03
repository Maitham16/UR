#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const benchmark = process.argv[2]
const configs = {
  'swe-bench-lite': {
    command: process.env.SWEBENCH_LITE_COMMAND ?? 'swebench',
    args: ['run', '--subset', 'lite'],
    env: 'SWEBENCH_LITE_COMMAND',
  },
  'terminal-bench': {
    command: process.env.TERMINAL_BENCH_COMMAND ?? 'terminal-bench',
    args: ['run'],
    env: 'TERMINAL_BENCH_COMMAND',
  },
  'aider-polyglot': {
    command: process.env.AIDER_POLYGLOT_COMMAND ?? 'aider',
    args: ['--benchmark', 'polyglot'],
    env: 'AIDER_POLYGLOT_COMMAND',
  },
}

if (!benchmark || !configs[benchmark]) {
  console.error('Usage: node scripts/benchmark-external.mjs <swe-bench-lite|terminal-bench|aider-polyglot>')
  process.exit(1)
}

const config = configs[benchmark]
const probe = spawnSync(config.command, ['--help'], {
  encoding: 'utf8',
  stdio: ['ignore', 'ignore', 'ignore'],
})

if (probe.error || probe.status !== 0) {
  console.log(
    `${benchmark}: skipped; command "${config.command}" is not available. Set ${config.env} to a working integration command.`,
  )
  process.exit(0)
}

console.log(`${benchmark}: running configured external benchmark command`)
const result = spawnSync(config.command, config.args, {
  encoding: 'utf8',
  stdio: 'inherit',
})
process.exit(result.status ?? (result.error ? 1 : 0))
