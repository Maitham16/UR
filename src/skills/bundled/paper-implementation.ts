import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const PAPER_IMPLEMENTATION_PROMPT = `# Paper Implementation Skill

Implement an algorithm, system, or model from a paper or URL in an isolated worktree. Add tests, a short write-up, and open a PR.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" to create a fresh git worktree and branch named "ur/paper-<timestamp>-<slug>".
2. If the user provided a URL, fetch it and summarize the core contribution, algorithm, and any pseudocode or equations. Cite the source.
3. Inspect the current codebase to find the best location and conventions for the implementation.

## Implementation

1. Implement the core algorithm or system in the project's language and style.
2. Keep the surface small and focused. Do not over-engineer.
3. Add unit tests that exercise normal cases, edge cases, and any properties claimed by the paper.
4. Add a brief markdown note (e.g., docs/paper-notes/<slug>.md or a README section) explaining what was implemented, the source, and how to run it.

## Verification

1. Run the new tests.
2. Run the project's typecheck, lint, or build command if applicable.
3. Commit the implementation, tests, and notes with clean messages.

## PR Output

1. Push the branch to origin.
2. Open a PR with:
   - Title: "feat(scope): implement <paper short name>"
   - Body: paper link, summary, implementation approach, test results, and the location of the write-up.

Return a concise summary: branch name, commits, PR URL, and the diff summary.
`

export function registerPaperImplementationSkill(): void {
  registerBundledSkill({
    name: 'paper-implementation',
    aliases: ['paper', 'implement-paper'],
    description:
      'Implement an algorithm or system from a paper/URL in an isolated worktree with tests, notes, and a PR.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'TestRunner', 'WebFetch'],
    argumentHint: '[paper URL or description]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = PAPER_IMPLEMENTATION_PROMPT
      if (args) {
        prompt += `\n\n## Paper or target\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
