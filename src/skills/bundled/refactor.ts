import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const REFACTOR_PROMPT = `# Refactor Skill: Safe, Test-Backed Refactoring

Perform a safe refactoring in an isolated worktree. Preserve behavior, add or update tests, and open a PR with clean commits.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" to create a fresh git worktree and branch named "ur/refactor-<timestamp>-<slug>".
2. Read the current code, tests, and the user's target description. Run the existing test/lint/typecheck command to establish a green baseline.

## Plan

1. State the refactoring goal and the smallest surface you will touch.
2. Identify the verification commands (tests, typecheck, lint) that must pass before and after the change.
3. If the refactor touches exported APIs or shared behavior, note migration impact.

## Execute

1. Make the minimal change. Prefer mechanical transformations (rename, extract function, inline, move) over speculative rewrites.
2. After each logical step, run the closest verification command.
3. Update tests and docs to match the new structure.
4. Commit each meaningful step with a clean message: "refactor(scope): description".

## Finish

1. Run the full verification suite in the worktree.
2. Push the branch and open a PR with:
   - Title: "refactor(scope): <short description>"
   - Body: goal, files changed, verification results, and any breaking/migration notes.

Return a concise summary: branch name, commits, PR URL, and the diff summary.
`

export function registerRefactorSkill(): void {
  registerBundledSkill({
    name: 'refactor',
    description:
      'Run a safe, test-backed refactoring in an isolated worktree and open a PR with clean commits.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'TestRunner'],
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
