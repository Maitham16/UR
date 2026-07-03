// Pure verifier-prompt building — no vscode dependency. There is no
// standalone `ur verify --json` CLI command; the real verification mechanism
// is the built-in `/verify` prompt command (src/commands/verify.ts), which
// spawns a "verification" subagent and reports a VERDICT line. This prompt
// mirrors that same mechanism as plain instruction text sent through the
// existing chat pathway — the same approach PR2's Explain/Fix/Generate Tests
// editor actions already use, rather than depending on `/`-command expansion
// inside the headless streaming bridge.

export function buildVerifierPrompt(): string {
  return [
    'Run verification on the current changes: spawn the verification subagent (Task tool, subagent_type="verification") to check the most recent task.',
    'Include in the subagent prompt: the files changed in the most recent task, a short summary of the approach taken, and any test/lint/build commands defined in the project.',
    'Wait for the VERDICT line from the subagent and report it verbatim, along with any findings. Do not declare the task complete unless the verdict is PASS.',
  ].join('\n')
}
