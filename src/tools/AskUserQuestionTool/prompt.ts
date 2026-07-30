import { EXIT_PLAN_MODE_TOOL_NAME } from '../ExitPlanModeTool/constants.js'

export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

export const ASK_USER_QUESTION_TOOL_CHIP_WIDTH = 12

export const DESCRIPTION =
  'Asks the user multiple choice questions to gather information, clarify ambiguity, understand preferences, make decisions or offer them choices. This is the required way to present the user with a choice: whenever you would otherwise end a message by asking the user to pick between options or decide a direction, call this tool instead of asking in plain text, so the user gets a selectable menu rather than having to type a free-form answer.'

export const PREVIEW_FEATURE_PROMPT = {
  markdown: `
Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
`,
  html: `
Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- Plain-text or ASCII mockups of UI layouts or components
- Inert code snippets showing different implementations
- Textual visual comparisons or diagrams

Preview content is untrusted text: raw HTML is not accepted or executed. It is escaped and rendered as inert preformatted text. Do not include HTML tags, attributes, URLs, scripts, styles, event handlers, or other executable markup. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
`,
} as const

export const ASK_USER_QUESTION_TOOL_PROMPT = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Strongly prefer this tool over asking a question in plain assistant text. Any time your reply would end with a question that offers the user options or asks them to choose a direction (e.g. "Would you like A or B?", "Which approach should I take?", "Want me to do X or Y?"), call this tool with those options instead so the user gets a selectable arrow-key menu. Only ask in plain text when the answer is genuinely open-ended and cannot be expressed as a small set of choices.

Strict input hierarchy:
- Invoke the tool with exactly one top-level \`questions\` array containing 1-4 complete question objects.
- Every question object contains \`question\`, a concise \`header\` (maximum 12 characters), and an \`options\` array with 2-8 option objects. Use \`multiSelect: true\` only when more than one choice may apply.
- Every option object contains a \`label\`. Add \`description\` only when it contributes a real consequence, trade-off, or limitation; \`preview\` is optional.
- Keep each question and its own options nested together. Never put option rows directly in the top-level \`questions\` array, and never send incomplete header/prompt-only entries.

Canonical valid tool arguments (invoke the structured tool; do not print this object as prose):
{"questions":[{"question":"Which database should we use?","header":"Database","options":[{"label":"PostgreSQL (Recommended)","description":"Strong consistency and concurrency; requires a running server and migrations."},{"label":"SQLite","description":"Zero setup and a single file; unsuitable for multiple concurrent writers."}],"multiSelect":false}]}

Usage notes:
- Users will always be able to select "Other" to provide custom text input, so it is safe to offer choices even when you are unsure you have listed every option
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label
- Do not over-question. Ask only decisions that materially affect the result and cannot be inferred safely. If more than four decisions are truly needed, ask the most blocking 1-4 first and ask the remainder in a later round.

Writing the three fields — they must each carry DIFFERENT information:
- \`header\` names the dimension being decided ("Database", "Auth method"). It is not a shortened copy of the question.
- \`label\` names the choice ("PostgreSQL"). It is not a restatement of the question.
- \`description\` says what happens if this is picked and what it costs — the trade-off, limitation or consequence the label does not already convey. It is the only field with room to be genuinely informative, so it must not paraphrase the label back to the user.

A description that can be derived from reading the label is wasted space and makes the menu harder to use, not easier. Before writing one, ask: does this tell the user something they could not already see? If not, replace it with the thing that actually distinguishes this option from its neighbours.

Bad — description restates the label:
  question: "Which database should we use?"
  header: "Which DB"                       (repeats the question)
  label: "Use PostgreSQL"  description: "Use PostgreSQL as the database."

Good — each field adds something:
  question: "Which database should we use?"
  header: "Database"
  label: "PostgreSQL"      description: "Relational with strong consistency; needs a running server and a migration step."
  label: "SQLite"          description: "Zero setup, single file; no concurrent writers, so it will not survive multiple workers."

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ${EXIT_PLAN_MODE_TOOL_NAME} for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ${EXIT_PLAN_MODE_TOOL_NAME}. If you need plan approval, use ${EXIT_PLAN_MODE_TOOL_NAME} instead.
`
