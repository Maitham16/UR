import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const BENCHMARK_PROMPT = `# Benchmark Skill

Add or run benchmarks for a specific component in an isolated worktree. Collect results, compare variants if requested, and optionally commit the benchmark code and results.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" and model "route: auto" to create a fresh git worktree and branch named "ur/benchmark-<timestamp>-<slug>". UR will pick a cheap or strong model based on the benchmark complexity.
2. Identify the target component and the existing benchmark tooling (e.g., <code>benchmark</code>, <code>denote</code>, <code>vitest bench</code>, <code>hyperfine</code>, shell <code>time</code>).

## Plan

1. State the metric you will measure (latency, throughput, memory, correctness, etc.).
2. Decide whether to add a new benchmark file or run an existing one.
3. If comparing implementations, keep the baseline and the candidate as close as possible.

## Execute

1. Write or run the benchmark. Keep it deterministic where possible and document stochastic variance.
2. Run it several times and record the results.
3. Keep any benchmark changes local in the worktree.
4. If results should persist, save them in a consistent format (e.g., JSON, markdown table).

## Finish

1. Use AskUserQuestion to ask whether the user wants the full benchmark and verification sequence rerun.
2. Run it only if approved; otherwise report the measurements already collected.
3. Do not commit, push, or open a PR unless separately requested.

Return a concise summary: branch name, benchmark command, results, and interpretation.
`

export function registerBenchmarkSkill(): void {
  registerBundledSkill({
    name: 'benchmark',
    aliases: ['bench', 'perf'],
    description:
      'Add or run benchmarks in an isolated worktree and optionally commit the benchmark code and results.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'TestRunner', 'AskUserQuestion'],
    argumentHint: '[component or benchmark goal]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = BENCHMARK_PROMPT
      if (args) {
        prompt += `\n\n## Benchmark target\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
