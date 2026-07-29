import type { Command } from '../../types/command.js'

const exec = {
  type: 'local',
  name: 'exec',
  description: 'Run one or more prompts in non-interactive mode with optional concurrency',
  argumentHint: '[prompts...] [--file <jsonl>] [--concurrency N] [--max-turns N] [--max-agents N] [--model <model>] [--output-dir <dir>] [--worktree] [--no-task-planning] [--no-parallel-agents] [--no-task-board] [--no-strict-verification] [--quiet] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./exec.js'),
} satisfies Command

export default exec
