import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const DEBUG_V2_PROMPT = `# Debug Skill: Reproduce, Root-Cause, and Fix

Reproduce, root-cause, and fix the described bug in an isolated worktree. Produce a regression test and a clean commit, then open a PR.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with \\"isolation: worktree\\" to create a fresh git worktree and branch named \\"ur/debug-<timestamp>-<slug>\\".
2. Inside the worktree, inspect the relevant files, tests, and reproduction steps. Read the current git state with \\"git status\\" and \\"git log --oneline -5\\".

## Reproduction

1. Build or run the project to confirm the environment is clean (compile, typecheck, lint, or the smallest equivalent command).
2. Write or run a focused reproduction test that fails against the current code. Use the existing test framework if one is present.
3. Capture the exact error message, stack trace, or incorrect output.

## Root-Cause Analysis

1. Trace the failure to the smallest code path that explains it.
2. Check for related call sites, tests, and configuration that might share the same defect.
3. Do not guess; cite files and lines.

## Fix

1. Make the minimal change that fixes the bug.
2. Run the reproduction test again and verify it passes.
3. Run the existing project tests or checks to ensure no regressions.
4. Commit the fix and the regression test with a clean message: \\"fix(scope): description\\".

## PR Output

1. Push the branch to origin.
2. Open a PR with:
   - Title: \\"fix: <short description>\\" or \\"fix(scope): <short description>\\"
   - Body containing the bug description, root cause, reproduction steps, and verification command.

Return a concise summary: branch name, commits, PR URL, and the diff summary.
`

export function registerDebugV2Skill(): void {
  registerBundledSkill({
    name: 'debug-v2',
    aliases: ['debug2', 'bugfix'],
    description:
      'Reproduce, root-cause, and fix a bug in an isolated worktree, then open a PR with a regression test.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'TestRunner'],
    argumentHint: '[bug description or reproduction steps]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = DEBUG_V2_PROMPT
      if (args) {
        prompt += `\n\n## Bug to fix\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
