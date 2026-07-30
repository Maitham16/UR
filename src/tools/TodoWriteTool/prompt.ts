export const PROMPT = `Use this tool to maintain the ordered work plan for the current session.

## When to use it

Create a todo list before every non-trivial workspace implementation. Work is
non-trivial when it needs planning, investigation, multiple deliverables,
dependencies, several features, or post-change verification. A feature-rich
single-file build is non-trivial even if one Write call could create it.
Investigate first when scope is unknown so the list records concrete outcomes.

Skip it only for a purely informational answer or a genuinely atomic one-shot
action with no planning, dependencies, or meaningful verification.

## Lifecycle

1. Decompose non-trivial work into one item per cohesive outcome with its own
   observable done check. Split separately completable deliverables out of
   omnibus items, but keep genuinely atomic work as one item; never create
   items merely for individual files, tool calls, or tiny mechanical steps.
2. Put todos in dependency order. Keep unrelated outcomes independent rather
   than inventing dependencies.
3. Provide both forms for every item:
   - \`content\`: imperative outcome, such as "Run tests".
   - \`activeForm\`: present-continuous status, such as "Running tests".
4. In the setup call, mark the next unblocked item \`in_progress\`. Inspect the
   successful TodoWrite result before any dependent Write, Edit, mutating
   shell, Agent, Task, or other state-changing call. Never batch todo setup
   with the work it enables. Keep only one item \`in_progress\` in this list.
5. Update the list immediately when requirements or discovered work change.
6. Mark an item \`completed\` only after its implementation and relevant
   verification have succeeded. Do not batch completion updates.
7. If work is partial, blocked, or failing, leave the item open and record the
   concrete follow-up or blocker in the list.
8. Remove an item only when it is genuinely obsolete or was created by mistake.
9. If every item is terminal and new work arrives, add a new pending/in_progress
   outcome or reopen the relevant item before changing state.

Never mark an item completed when tests still fail, an error is unresolved, a
required dependency is missing, or only part of the outcome was implemented.
After each completion, continue with the next unblocked item until every
required todo is completed or an honest blocker has been reported.

Invoke tools through their native structured interfaces. Narrating a todo,
file edit, or command does not execute it, and printed arguments are not a
substitute for a tool call.`

export const DESCRIPTION =
  'Create and update the ordered todo list for multi-step work. Keep statuses current and complete items only after relevant verification succeeds.'
