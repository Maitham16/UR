// L2 nudge.
//
// When L1 passes on a mutating turn and the model emitted no tool call
// (i.e. it's about to declare the task complete), the verifier asks the
// loop to inject one strong reminder telling the model to spawn the
// independent verification subagent before yielding the final response.
//
// This is "automatic" in that the verifier always asks for the spawn,
// but the spawn itself is performed by the model via its existing Task
// tool — keeping the L1/L2 wiring small and reusing AgentTool's
// well-tested machinery.
//
// Defense: the nudge fires at most once per turn so a model that ignores
// it does not get stuck in an infinite reminder loop.

const VERIFIER_AGENT_TYPE = 'verification'

export type SubagentNudge = {
  /** The reminder text to inject as a <system-reminder> user message. */
  reminder: string
}

/**
 * Build the nudge reminder string. Includes a tight summary of what the
 * turn modified so the verification agent has enough context without
 * re-deriving it. Caller is responsible for only invoking this once per
 * turn (see Verifier.markSubagentNudged).
 */
export function buildSubagentNudge(args: {
  modifiedFiles: string[]
  ranBash: boolean
  userTaskHint: string | undefined
}): SubagentNudge {
  const fileList = args.modifiedFiles.slice(0, 20).map(f => `  - ${f}`).join('\n')
  const moreFiles =
    args.modifiedFiles.length > 20
      ? `\n  (… and ${args.modifiedFiles.length - 20} more)`
      : ''
  const filesBlock = args.modifiedFiles.length > 0
    ? `Files changed this turn:\n${fileList}${moreFiles}`
    : 'No file edits this turn.'
  const bashBlock = args.ranBash
    ? 'Bash commands were executed this turn.'
    : ''
  const hint = args.userTaskHint
    ? `\nOriginal user request (verbatim, first 400 chars):\n${args.userTaskHint.slice(0, 400)}`
    : ''

  const reminder =
    `The deterministic verifier (L1) just passed for this turn. Before you ` +
    `tell the user you are done, you MUST spawn the independent verifier ` +
    `subagent and wait for its verdict.\n\n` +
    `How: call the Task tool with subagent_type="${VERIFIER_AGENT_TYPE}". ` +
    `In the description field, write a short label (e.g. "verify changes"). ` +
    `In the prompt field, include:\n` +
    `1. The original user request below.\n` +
    `2. The list of files changed below.\n` +
    `3. A 1-2 sentence summary of the approach you took.\n\n` +
    `${filesBlock}\n${bashBlock}${hint}\n\n` +
    `Do not declare the task complete in this turn. Spawn the verifier ` +
    `subagent first, read its VERDICT line, and only then write your final ` +
    `response. If the verifier returns FAIL, fix the issue and re-verify ` +
    `before declaring done.`

  return { reminder }
}
