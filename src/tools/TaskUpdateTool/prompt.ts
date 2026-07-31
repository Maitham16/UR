export const DESCRIPTION = 'Update a task in the task list'

export const PROMPT = `Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as completed:**
- When you have completed the work described in a task
- IMPORTANT: Always mark your assigned tasks as completed when you finish them
- After completion, call TaskList to find the next unblocked task

- ONLY mark a task as completed when you have FULLY accomplished it
- If an error prevents completion, use \`failed\` and state the evidence in the task description or metadata
- If work is intentionally not applicable or deliberately omitted, use \`skipped\` and record why
- When blocked, add the blocking task with \`addBlockedBy\`; the UI derives a blocked state while the dependency remains unresolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to \`deleted\` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Normal success progresses: \`pending\` → \`in_progress\` → \`completed\`.

Use \`failed\` for attempted work that did not complete, and \`skipped\` for work intentionally not performed. A blocked task remains \`pending\` or \`in_progress\` with unresolved \`blockedBy\` entries; \`blocked\` is a derived display state rather than a writable status.

Use \`deleted\` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using \`TaskGet\` before updating it.

## Examples

Mark task as in progress when starting work:
\`\`\`json
{"taskId": "1", "status": "in_progress"}
\`\`\`

Mark task as completed after finishing work:
\`\`\`json
{"taskId": "1", "status": "completed"}
\`\`\`

Delete a task:
\`\`\`json
{"taskId": "1", "status": "deleted"}
\`\`\`

Claim a task by setting owner:
\`\`\`json
{"taskId": "1", "owner": "my-name"}
\`\`\`

Set up task dependencies:
\`\`\`json
{"taskId": "2", "addBlockedBy": ["1"]}
\`\`\`
`
