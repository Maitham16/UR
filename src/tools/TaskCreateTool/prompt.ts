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

- Complex multi-step tasks - When a request requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations${teammateContext}
- Multiple independently verifiable outcomes, dependency ordering, delegation, or parallel work
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User asks to queue work - When the user says "add to your tasks", "add this to your task list", "put this on the list", "queue this up", or anything similar, IMMEDIATELY call this tool with that request — even if you are in the middle of other work and even if the item sounds small. The user is watching the live task panel and expects the item to appear there right away. Acknowledge briefly and continue what you were doing unless asked to switch.
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- When new instructions materially change multi-step work - update the plan before continuing

## When NOT to Use This Tool

Skip using this tool when:
- The task is purely conversational or informational
- The request is one direct, low-risk action that can be completed and verified as one operation
- The user sends a short acknowledgement, correction, or clarification that does not add a distinct outcome to an existing board

Do not create a task merely because a user sent a message or because the request is actionable. Task subjects must describe concrete outcomes chosen after understanding the work; never copy the raw prompt into a task title.

EXCEPTION: none of the "skip" rules apply when the user explicitly asks for an item to be added to the task list ("add to your tasks …"). An explicit request always wins — create the task.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: What needs to be done
- **activeForm** (optional): Present continuous form shown in the spinner when the task is in_progress (e.g., "Fixing authentication bug"). If omitted, the spinner shows the subject instead.
- **blocks** / **addBlocks** (optional): Existing task IDs this task blocks
- **blockedBy** / **addBlockedBy** (optional): Existing task IDs that block this task
- **addToCurrentList** (optional): Set to \`true\` when the user explicitly asks to append to the current/existing task list. A new prompt archives the previous list only when it has no pending or in-progress work; an interruption preserves active work for reconciliation.

All tasks are created with status \`pending\`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Never guess task IDs or reference a task that has not been created yet. For a multi-task plan, create tasks without forward edges, wait for their real IDs, then use TaskUpdate to add dependency edges.
- A task can depend only on an existing different task; never add a self-dependency.
${teammateTips}- Check TaskList first to avoid creating duplicate tasks
- Use TaskUpdate, not TaskCreate, for status or ownership changes
- After an interruption, call TaskList, keep relevant active work, update the affected task, add a task only for a genuinely distinct new outcome, and mark superseded work skipped
- Do not set \`addToCurrentList\` merely because earlier tasks exist; runtime already preserves interrupted work, while this flag is reserved for explicit user intent such as "add this to the current list"
`
}
