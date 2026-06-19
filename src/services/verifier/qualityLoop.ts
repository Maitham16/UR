// L4 quality loop.
//
// After the deterministic verifier and independent verification pass on a
// mutating turn, the loop can request a final self-evaluation from the model.
// The model must emit a structured QUALITY verdict. LOW verdicts trigger a
// bounded retry reminder that asks for a materially different strategy.

export type QualityVerdict = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

const QUALITY_VERDICT_RE = /^\s*QUALITY:\s*(HIGH|MEDIUM|LOW)\b/im
const MAX_CHANGED_FILES = 10
const MAX_EVAL_TASK_HINT_CHARS = 300
const MAX_RETRY_TASK_HINT_CHARS = 400
const MAX_PREVIOUS_RESPONSE_CHARS = 500

function truncateText(text: string | undefined, maxChars: number): string | undefined {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}...`
}

function formatChangedFiles(files: string[]): string {
  if (files.length === 0) return 'No file edits were recorded for this turn.'

  const visibleFiles = files
    .slice(0, MAX_CHANGED_FILES)
    .map(file => `  - ${file}`)
    .join('\n')
  const remainingCount = files.length - MAX_CHANGED_FILES
  const remainingLine = remainingCount > 0
    ? `\n  (... and ${remainingCount} more)`
    : ''

  return `Files changed this turn:\n${visibleFiles}${remainingLine}`
}

/**
 * Extract the QUALITY verdict from an assistant message text. Returns
 * UNKNOWN if no QUALITY line was found. Callers should treat UNKNOWN as a
 * non-event (fall through to completion) rather than retry.
 */
export function parseQualityVerdict(text: string): QualityVerdict {
  if (!text) return 'UNKNOWN'
  const match = QUALITY_VERDICT_RE.exec(text)
  if (!match) return 'UNKNOWN'
  const captured = match[1]
  if (!captured) return 'UNKNOWN'
  return captured.toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW'
}

/**
 * Build the reminder asking the model to evaluate its previous response.
 * The model is expected to emit one final assistant turn that includes
 * the QUALITY: line in its text.
 */
export function buildQualityEvalReminder(args: {
  modifiedFiles: string[]
  userTaskHint: string | undefined
}): string {
  const filesBlock = formatChangedFiles(args.modifiedFiles)
  const taskHint = truncateText(args.userTaskHint, MAX_EVAL_TASK_HINT_CHARS)
  const taskBlock = taskHint
    ? `\nOriginal user request excerpt:\n${taskHint}`
    : ''

  return (
    `Quality review required. Before finalizing this turn, evaluate the ` +
    `response you prepared against the criteria below. Be direct and ` +
    `specific; the goal is to catch material issues before the final ` +
    `response is shown to the user.\n\n` +
    `${filesBlock}${taskBlock}\n\n` +
    `Criteria:\n` +
    `1. Completeness: every part of the user request was addressed.\n` +
    `2. Accuracy: factual claims, code references, and command results are ` +
    `correct.\n` +
    `3. Execution: required tools or checks were actually run, not only ` +
    `described.\n` +
    `4. Transparency: the response does not claim work that was not ` +
    `performed.\n` +
    `5. Clarity: the final response is structured so the user can scan it ` +
    `quickly.\n\n` +
    `End with exactly one verdict line using this format:\n` +
    `QUALITY: <HIGH|MEDIUM|LOW> - <one-sentence rationale>\n\n` +
    `Use the literal prefix \`QUALITY:\` followed by exactly one of ` +
    `\`HIGH\`, \`MEDIUM\`, or \`LOW\`. Do not add Markdown formatting or ` +
    `alternative labels. If a material issue remains unresolved, choose ` +
    `LOW.\n\n` +
    `When choosing LOW, include the specific different approach that should ` +
    `be used on retry, such as reading the authoritative file first, running ` +
    `the failing command, or asking for the missing branch name.`
  )
}

/**
 * Build the retry reminder injected when the previous self-eval came back
 * LOW. Tells the model to use the alternative approach it already named,
 * not to polish the same path.
 */
export function buildQualityRetryReminder(args: {
  previousAssistantText: string
  userTaskHint: string | undefined
  attempt: number
  maxAttempts: number
}): string {
  const taskHint = truncateText(args.userTaskHint, MAX_RETRY_TASK_HINT_CHARS)
  const taskBlock = taskHint
    ? `Original user request excerpt:\n${taskHint}\n\n`
    : ''
  const previousQuote =
    truncateText(args.previousAssistantText, MAX_PREVIOUS_RESPONSE_CHARS) ?? ''

  return (
    `${taskBlock}` +
    `The previous self-evaluation returned LOW. Retry attempt ` +
    `${args.attempt} of ${args.maxAttempts}.\n\n` +
    `Previous response excerpt:\n${previousQuote}\n\n` +
    `Retry the original task using a materially different strategy. Do not ` +
    `revise the same response in place. If the LOW rationale identified an ` +
    `alternative approach, use that approach now.\n\n` +
    `Appropriate changes in strategy include:\n` +
    `- Inspecting the authoritative source file instead of relying on an ` +
    `assumption.\n` +
    `- Running the relevant command and iterating on its actual output.\n` +
    `- Switching to a more precise search or decomposition when the first ` +
    `pass was too broad.\n` +
    `- Asking the user for a missing required value when the task cannot be ` +
    `completed safely without it.\n` +
    `- Reducing scope to the minimum change that satisfies the user request ` +
    `when the prior approach over-expanded the task.\n\n` +
    `After the retry, the quality review will run again. If the result still ` +
    `cannot reach MEDIUM or HIGH within the retry budget, report the ` +
    `remaining limitation plainly.`
  )
}
