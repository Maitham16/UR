// Pure diff-review prompt building — no vscode dependency, so this stays
// directly testable under `bun test` (see reviewDiff.ts for the vscode-side
// orchestration that calls into this).

/** Characters, not bytes — a rough, cheap proxy for "this is a lot of
 * context to hand an LLM," not a token count. */
export const LARGE_DIFF_THRESHOLD = 20000

export function buildReviewPrompt(diff: string): string {
  return [
    'Review the current git diff for correctness, style, and potential bugs.',
    'Point out specific issues with file references where possible, and suggest concrete improvements.',
    '',
    '```diff',
    diff,
    '```',
  ].join('\n')
}
