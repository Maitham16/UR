import { FILE_EDIT_TOOL_NAME } from '../FileEditTool/constants.js'

// This prompt was cut from 184 lines to 48 after 1.65.5, which removed every
// worked example and left only abstract rules ("work is non-trivial when it
// needs planning, investigation, multiple deliverables..."). Large models infer
// the intent from rules; small local models do not — they pattern-match on
// examples. Task lists stopped appearing, and the task-list gate was then
// hardened repeatedly to force what the prompt no longer taught, which is what
// produced blocked writes and retry loops.
//
// The rules from the shorter version are good and are kept below. What is
// restored is the demonstrations: when to use it, when not to, and why.
//
// The cut was not baseless, though. The original examples narrated tool use as
// prose — "* Uses the Edit tool to add a comment *", "*Executes: npm install*"
// — which is the exact anti-pattern the last paragraph of this prompt forbids,
// and a model that pattern-matches on them learns to describe a tool call
// instead of making one. That is the "it said it wrote the file and did not"
// failure. So the examples come back for their decision value, with every
// narrated execution removed. test/promptExecutionContract.test.ts enforces
// both halves: the guidance must be present, the narration must not.

export const PROMPT = `Use this tool to create and manage the ordered work plan for the current session. It tracks progress, organises complex work, and shows the user where their request stands.

## When to Use This Tool

Use this tool proactively in these scenarios:

1. Complex multi-step tasks — when a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks — tasks that require careful planning or multiple operations
3. User explicitly requests a todo list
4. User provides multiple tasks — a list of things to be done (numbered or comma-separated)
5. After receiving new instructions — immediately capture user requirements as todos
6. When you start working on a task — mark it in_progress BEFORE beginning work; only one item should be in_progress at a time
7. After completing a task — mark it completed and add any follow-up work discovered during implementation

Work is non-trivial when it needs planning, investigation, multiple
deliverables, dependencies, several features, or post-change verification.
Investigate first when scope is unknown so the list records concrete
outcomes rather than guesses. A feature-rich
single-file build is non-trivial even if one Write call could create it.

## When NOT to Use This Tool

Skip using this tool when:

1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organisational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

If there is one trivial task to do, just do it. Ceremony on a one-line request
is what trains users to switch this off.

## Examples of When to Use the Todo List

<example>
User: I want to add a dark mode toggle to the application settings. Make sure you run the tests and build when you're done!
Assistant: *Creates todo list with the following items:*
1. Creating dark mode toggle component in Settings page
2. Adding dark mode state management (context/store)
3. Implementing CSS-in-JS styles for dark theme
4. Updating existing components to support theme switching
5. Running tests and build process, addressing any failures or errors that occur
*Begins working on the first task*

<reasoning>
The assistant used the todo list because:
1. Adding dark mode is a multi-step feature requiring UI, state management, and styling changes
2. The user explicitly requested tests and build be run afterward
3. The assistant added the verification step as its own tracked outcome
</reasoning>
</example>

<example>
User: Help me rename the function getCwd to getCurrentWorkingDirectory across my project
Assistant: *Uses grep or search tools to locate all instances of getCwd in the codebase*
I've found 15 instances of 'getCwd' across 8 different files.
*Creates todo list with specific items for each file that needs updating*

<reasoning>
The assistant used the todo list because:
1. It searched first to understand the scope of the task
2. Finding multiple occurrences across files made this a multi-step task
3. The list ensures every instance is tracked and updated systematically
</reasoning>
</example>

<example>
User: I need to implement these features for my e-commerce site: user registration, product catalog, shopping cart, and checkout flow.
Assistant: *Creates a todo list breaking down each feature into specific tasks based on the project architecture*
Let's start with user registration.

<reasoning>
The assistant used the todo list because:
1. The user provided multiple complex features in a comma-separated list
2. The list organises large features into manageable outcomes
3. It allows tracking progress across the entire implementation
</reasoning>
</example>

<example>
User: make me a warship space game, full advanced, one file html+js
Assistant: *Creates todo list: 1) Scaffold the HTML shell and canvas, 2) Implement the render and game loop, 3) Implement player ship movement and physics, 4) Implement enemy fleet and AI, 5) Implement collision, damage and scoring, 6) Write the file and verify it opens in a browser*
*Marks the first item in_progress, then writes the file*

<reasoning>
The assistant used the todo list because a "full advanced" game is a
feature-rich build with several independent systems and a verification step,
even though the deliverable is a single file produced by one Write call. The
number of files is not what makes work non-trivial.
</reasoning>
</example>

## Examples of When NOT to Use the Todo List

<example>
User: How do I print 'Hello World' in Python?
Assistant: In Python, you can print "Hello World" with this simple code:

python
print("Hello World")

<reasoning>
A single trivial task completed in one step. Nothing to track.
</reasoning>
</example>

<example>
User: What does the git status command do?
Assistant: The git status command shows the current state of your working directory and staging area.

<reasoning>
An informational request with no coding task to complete.
</reasoning>
</example>

<example>
User: Can you add a comment to the calculateTotal function to explain what it does?
Assistant: Adds the comment with a single ${FILE_EDIT_TOOL_NAME} call and reports the result.

<reasoning>
A single straightforward edit confined to one location. No systematic
organisation required. Note that the edit is performed by issuing the tool
call, not by describing it — a narrated action is not an executed one.
</reasoning>
</example>

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
  'Create and update the ordered todo list for multi-step work. Use proactively for tasks with 3 or more steps. Keep statuses current, keep exactly one item in_progress, and complete items only after relevant verification succeeds.'
