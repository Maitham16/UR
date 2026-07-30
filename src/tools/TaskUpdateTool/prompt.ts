export const DESCRIPTION = 'Update a task in the task list'

export const PROMPT = `Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as completed:**
- When you have completed the work described in a task
- IMPORTANT: Always mark your assigned tasks as completed when you finish them
- After completion, call TaskList to find the next unblocked task

- ONLY mark a task as completed when you have FULLY accomplished it
- After changing a file, run a relevant observable check in a later tool turn
  before completing the final actionable task. A Write/Edit result proves only
  that bytes changed, not that the result works.
- If that final completion has no successful post-change check, TaskUpdate
  keeps the same task in_progress and names the next verification action. Run
  it and retry completion; do not create a duplicate task.
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, record the blocking work as a dependency or notify the owner
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

Status progresses: \`pending\` → \`in_progress\` → \`completed\`

Use \`deleted\` to permanently remove a task.

## Staleness

Read a task's latest state using \`TaskGet\` before updating it when another
worker may have changed it or when your local state may be stale. A task you
just created or read does not need an immediate redundant read.

## Examples

- Start task 1: set \`taskId\` to \`1\` and \`status\` to \`in_progress\`.
- Complete task 1 after its checks pass: set \`status\` to \`completed\`.
- Delete task 1: set \`status\` to \`deleted\`.
- Claim task 1: set \`owner\` to your worker name.
- Make task 2 wait for task 1: add \`1\` to \`addBlockedBy\`.

Invoke \`TaskUpdate\` through its native structured tool interface for each
update. These field descriptions are not a substitute for a tool call.
`
