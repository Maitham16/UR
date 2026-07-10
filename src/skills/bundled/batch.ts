import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js'
import { ENTER_PLAN_MODE_TOOL_NAME } from '../../tools/EnterPlanModeTool/constants.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from '../../tools/ExitPlanModeTool/constants.js'
import { SKILL_TOOL_NAME } from '../../tools/SkillTool/constants.js'
import { getIsGit } from '../../utils/git.js'
import { registerBundledSkill } from '../bundledSkills.js'

const MIN_AGENTS = 5
const MAX_AGENTS = 30

const WORKER_INSTRUCTIONS = `After implementing the assigned unit:
1. Invoke the ${SKILL_TOOL_NAME} tool with skill "simplify" and apply only relevant cleanup.
2. Run the smallest test or check that directly covers this unit. Do not run the full project suite.
3. Keep all work local. Do not commit, push, or create a pull request.
4. End with "WORKTREE: <path or branch>" and report the focused command and result.`

function buildPrompt(instruction: string): string {
  return `# Batch: Parallel Work Orchestration

## User Instruction

${instruction}

## Phase 1: Research and Plan

Call ${ENTER_PLAN_MODE_TOOL_NAME}, then:

1. Research the complete affected surface with foreground subagents.
2. Decompose it into ${MIN_AGENTS}-${MAX_AGENTS} independent, similarly sized units. Every unit must be implementable in an isolated worktree and mergeable without another unit landing first.
3. Identify the focused verification command for each unit and a final integration suite for the combined change. Do not run the final suite yet.
4. Write a plan containing the research summary, numbered units with file ownership, focused checks, integration suite, and the exact worker instructions below.
5. Call ${EXIT_PLAN_MODE_TOOL_NAME} and wait for plan approval.

Worker instructions:

${WORKER_INSTRUCTIONS}

## Phase 2: Spawn Workers

After plan approval, spawn one background ${AGENT_TOOL_NAME} per unit in a single message. Every worker must use isolation "worktree" and run_in_background true. Include the overall goal, exact unit scope, conventions, focused check, and the worker instructions verbatim.

## Phase 3: Track and Finish

Track results in this format:

| # | Unit | Status | Worktree |
|---|------|--------|----------|
| 1 | <title> | running | - |

Parse each worker's WORKTREE line and keep failures visible. When all workers finish, render the final table and summarize conflicts or integration risks.

Then use ${ASK_USER_QUESTION_TOOL_NAME} to ask whether the user wants the final integration/verification suite run. Run it only after approval. Do not commit, push, or open a PR unless the user makes a separate explicit request.`
}

const NOT_A_GIT_REPO_MESSAGE = 'This is not a git repository. /batch requires git because it uses isolated worktrees. Initialize a repo first or run it inside an existing one.'

const MISSING_INSTRUCTION_MESSAGE = `Provide an instruction describing the batch change.

Examples:
  /batch migrate from react to vue
  /batch replace lodash uses with native equivalents
  /batch add type annotations to untyped functions`

export function registerBatchSkill(): void {
  registerBundledSkill({
    name: 'batch',
    description:
      'Research and plan a large change, then execute it across 5-30 isolated worktree agents.',
    allowedTools: [
      AGENT_TOOL_NAME,
      ASK_USER_QUESTION_TOOL_NAME,
      ENTER_PLAN_MODE_TOOL_NAME,
      EXIT_PLAN_MODE_TOOL_NAME,
      SKILL_TOOL_NAME,
      'Read',
      'Grep',
      'Glob',
      'Bash',
      'TestRunner',
    ],
    whenToUse:
      'Use when the user requests a broad mechanical change that can be divided into independent file or module units.',
    argumentHint: '<instruction>',
    userInvocable: true,
    disableModelInvocation: true,
    async getPromptForCommand(args) {
      const instruction = args.trim()
      if (!instruction) return [{ type: 'text', text: MISSING_INSTRUCTION_MESSAGE }]
      if (!(await getIsGit())) return [{ type: 'text', text: NOT_A_GIT_REPO_MESSAGE }]
      return [{ type: 'text', text: buildPrompt(instruction) }]
    },
  })
}
