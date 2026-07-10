import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const DEBUG_V2_PROMPT = `# Debug Skill: Reproduce, Root-Cause, and Fix

Reproduce, root-cause, and fix the described bug in an isolated worktree. Produce a regression test and keep publishing user-controlled.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" and model "route: strong" to create a fresh git worktree and branch named "ur/debug-<timestamp>-<slug>".
2. Inside the worktree, inspect the relevant files, tests, and reproduction steps. Read the current git state with "git status" and "git log --oneline -5".

## Reproduction

1. Build or run the project to confirm the environment is clean using the smallest relevant command.
2. Write or run a focused reproduction test that fails against the current code.
3. Capture the exact error message, stack trace, or incorrect output.

## Root-Cause Analysis

1. Trace the failure to the smallest code path that explains it.
2. Check related call sites, tests, and configuration that might share the defect.
3. Do not guess; cite files and lines.

## Fix

1. Make the minimal change that fixes the bug.
2. Run the reproduction test again and verify it passes.
3. Keep the fix and regression test local in the worktree.

## Finish

1. Use AskUserQuestion to ask whether the user wants the full project verification suite run.
2. Run it only if approved; otherwise report the focused regression evidence.
3. Do not commit, push, or open a PR unless the user makes a separate explicit request.

Return a concise summary: branch name, root cause, files changed, regression evidence, and diff summary.
`

export function registerDebugV2Skill(): void {
  registerBundledSkill({
    name: 'debug-v2',
    aliases: ['debug2', 'bugfix'],
    description:
      'Reproduce, root-cause, and fix a bug in an isolated worktree with a regression test.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'TestRunner', 'AskUserQuestion'],
    argumentHint: '[bug description or reproduction steps]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = DEBUG_V2_PROMPT
      if (args) prompt += `\n\n## Bug to fix\n\n${args}`
      return [{ type: 'text', text: prompt }]
    },
  })
}
