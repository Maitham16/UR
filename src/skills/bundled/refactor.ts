import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const REFACTOR_PROMPT = `# Refactor Skill: Safe, Test-Backed Refactoring

Perform a safe refactoring in an isolated worktree. Preserve behavior and add or update focused tests. Keep publishing user-controlled.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" and model "route: auto" to create a fresh git worktree and branch named "ur/refactor-<timestamp>-<slug>". UR will pick a cheap or strong model based on the refactor complexity.
2. Read the current code, tests, and the user's target description. Run the existing test/lint/typecheck command to establish a green baseline.

## Plan

1. State the refactoring goal and the smallest surface you will touch.
2. Identify the verification commands (tests, typecheck, lint) that must pass before and after the change.
3. If the refactor touches exported APIs or shared behavior, note migration impact.

## Execute

1. Make the minimal change. Prefer mechanical transformations (rename, extract function, inline, move) over speculative rewrites.
2. After each logical step, run the closest verification command.
3. Update tests and docs to match the new structure.
4. Keep the changes local in the worktree; do not commit, push, or open a PR.

## Finish

1. Use AskUserQuestion to ask whether the user wants the full verification suite run in the worktree.
2. If approved, run it and report the exact results. If declined, report the focused checks already completed.
3. Do not commit, push, or open a PR unless the user makes a separate explicit request.

Return a concise summary: worktree branch, files changed, verification evidence, and diff summary.
`

export function registerRefactorSkill(): void {
  registerBundledSkill({
    name: 'refactor',
    description:
      'Run a safe, test-backed refactoring in an isolated worktree and leave the result ready for review.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'TestRunner', 'AskUserQuestion'],
    argumentHint: '[refactoring goal]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = REFACTOR_PROMPT
      if (args) {
        prompt += `\n\n## Refactoring target\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
