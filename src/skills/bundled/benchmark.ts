import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const BENCHMARK_PROMPT = `# Benchmark Skill

Add or run benchmarks for a specific component in an isolated worktree. Collect results, compare variants if requested, and optionally commit the benchmark code and results.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" to create a fresh git worktree and branch named "ur/benchmark-<timestamp>-<slug>".
2. Identify the target component and the existing benchmark tooling (e.g., <code>benchmark</code>, <code>denote</code>, <code>vitest bench</code>, <code>hyperfine</code>, shell <code>time</code>).

## Plan

1. State the metric you will measure (latency, throughput, memory, correctness, etc.).
2. Decide whether to add a new benchmark file or run an existing one.
3. If comparing implementations, keep the baseline and the candidate as close as possible.

## Execute

1. Write or run the benchmark. Keep it deterministic where possible and document stochastic variance.
2. Run it several times and record the results.
3. If a change was required to add the benchmark, commit it with "bench(scope): add benchmark for X".
4. If results should persist, save them in a consistent format (e.g., JSON, markdown table).

## Finish

1. Push the branch only if code or saved results were committed.
2. Open a PR with:
   - Title: "bench(scope): <short description>"
   - Body: what was benchmarked, command, results, and interpretation.

Return a concise summary: branch name, commits, PR URL (if any), and the results.
`

export function registerBenchmarkSkill(): void {
  registerBundledSkill({
    name: 'benchmark',
    aliases: ['bench', 'perf'],
    description:
      'Add or run benchmarks in an isolated worktree and optionally commit the benchmark code and results.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'TestRunner'],
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
