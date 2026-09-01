import { EXIT_PLAN_MODE_TOOL_NAME } from '../ExitPlanModeTool/constants.js'

export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

export const ASK_USER_QUESTION_TOOL_CHIP_WIDTH = 12

export const DESCRIPTION =
  'Asks the user selectable questions to gather information, clarify ambiguity, understand preferences, make decisions, or offer choices. This is mandatory for every user-facing question with two or more plausible concrete answers: call this tool instead of asking in plain text. Plain-text questions are allowed only when the answer is genuinely open-ended and no useful concrete choices can be formed.'

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
- HTML mockups of UI layouts or components
- Formatted code snippets showing different implementations
- Visual comparisons or diagrams

Preview content must be a self-contained HTML fragment (no <html>/<body> wrapper, no <script> or <style> tags — use inline style attributes instead). Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
`,
} as const

export const ASK_USER_QUESTION_TOOL_PROMPT = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

This tool is REQUIRED for every real user-facing question that has two or more plausible concrete answers. Never ask such a question in plain assistant text, even when the choices are implicit, numerous, or easy to type. If you can name useful alternatives, put them in this tool so the user gets a selectable arrow-key menu. Ask in plain text only when the answer is genuinely open-ended and no meaningful concrete choices can be formed. Do not turn rhetorical questions into tool calls.

Usage notes:
- Users will always be able to select "Other" to provide custom text input, so it is safe to offer choices even when you are unsure you have listed every option
- Prefer 2-8 focused options when that covers the decision, but include every meaningful option when a legitimate decision has more than eight; never discard choices just to meet a menu-size target
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

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
