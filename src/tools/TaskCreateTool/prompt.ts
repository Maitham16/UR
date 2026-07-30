import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'

export const DESCRIPTION = 'Create a new task in the task list'

export function getPrompt(): string {
  const teammateContext = isAgentSwarmsEnabled()
    ? ' and potentially assigned to teammates'
    : ''

  const teammateTips = isAgentSwarmsEnabled()
    ? `- Include enough detail in the description for another agent to understand and complete the task
- New tasks are created with status 'pending' and no owner - use TaskUpdate with the \`owner\` parameter to assign them
`
    : ''

  return `Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations${teammateContext}
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User asks to queue work - When the user says "add to your tasks", "add this to your task list", "put this on the list", "queue this up", or anything similar, IMMEDIATELY call this tool with that request — even if you are in the middle of other work and even if the item sounds small. The user is watching the live task panel and expects the item to appear there right away. Acknowledge briefly and continue what you were doing unless asked to switch.
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- When new instructions materially change multi-step work - update the plan before continuing

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

EXCEPTION: none of the "skip" rules apply when the user explicitly asks for an item to be added to the task list ("add to your tasks …"). An explicit request always wins — create the task.

## Decomposition Quality

For non-trivial work, create the complete task graph before implementation:

- One task represents one cohesive outcome with an observable done check.
  Split an omnibus task when it contains separately completable deliverables.
- Keep a genuinely atomic outcome as one task. Do not manufacture tasks for
  individual files, tool calls, or tiny mechanical steps.
- Express real ordering constraints with \`blocks\` / \`blockedBy\`. Leave
  unrelated tasks unblocked so agents can claim them in parallel.
- If delegation is available, launch mutually independent tasks concurrently
  only when they have no conflicting shared mutations. Keep dependent or
  conflicting work sequential.
- Emit one \`TaskCreate\` call per outcome. Batch independent creates in the
  same assistant turn (up to 8), then use \`TaskUpdate\` to add dependency
  edges once IDs are known and before starting blocked work.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: What needs to be done
- **activeForm** (optional): Present continuous form shown in the spinner when the task is in_progress (e.g., "Fixing authentication bug"). If omitted, the spinner shows the subject instead.
- **blocks** / **addBlocks** (optional): Task IDs this task blocks
- **blockedBy** / **addBlockedBy** (optional): Task IDs that block this task

All tasks are created with status \`pending\`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Provide dependencies during creation when known, or use TaskUpdate later to adjust them
${teammateTips}- Check TaskList first to avoid creating duplicate tasks
- Use TaskUpdate, not TaskCreate, for status or ownership changes
`
}
