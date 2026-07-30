export const PROMPT = `Use this tool to maintain the ordered work plan for the current session.

## When to use it

Create a todo list before implementation when work has three or more distinct
steps, the user gives multiple deliverables, or the user explicitly asks for a
plan. Investigate first when the scope is unknown so the plan records concrete
outcomes rather than guesses.

Skip it for a single trivial action, a purely informational answer, or a task
that can be completed clearly in fewer than three small steps.

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
4. Mark the next unblocked item \`in_progress\` when work starts. Keep only one
   item \`in_progress\` in this agent's list.
5. Update the list immediately when requirements or discovered work change.
6. Mark an item \`completed\` only after its implementation and relevant
   verification have succeeded. Do not batch completion updates.
7. If work is partial, blocked, or failing, leave the item open and record the
   concrete follow-up or blocker in the list.
8. Remove an item only when it is genuinely obsolete or was created by mistake.

Never mark an item completed when tests still fail, an error is unresolved, a
required dependency is missing, or only part of the outcome was implemented.
After each completion, continue with the next unblocked item until every
required todo is completed or an honest blocker has been reported.

Invoke tools through their native structured interfaces. Narrating a todo,
file edit, or command does not execute it, and printed arguments are not a
substitute for a tool call.`

export const DESCRIPTION =
  'Create and update the ordered todo list for multi-step work. Keep statuses current and complete items only after relevant verification succeeds.'
