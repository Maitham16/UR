import type { ContentBlockParam } from '@urhq-ai/sdk/resources/messages.mjs'
import type { Command } from '../commands.js'

const VERIFY_PROMPT = (focus: string) => {
  const focusLine = focus
    ? `Focus the verification specifically on: ${focus}.`
    : `Verify the changes from the most recent task.`
  return `Spawn the verification subagent now.

How: call the Task tool with subagent_type="verification".
Description: a short label like "verify recent changes".
Prompt to the subagent must include:
  1. ${focusLine}
  2. The list of files you changed in the most recent task (read them
     from the transcript if needed).
  3. A 1-2 sentence summary of the approach you took.
  4. A pointer to any test / lint / build commands defined in the
     project (package.json scripts, Makefile, etc.).

Wait for the subagent's VERDICT line. Report it verbatim to me along
with any findings the subagent surfaced. Do NOT declare the task
complete unless the verdict is PASS.`
}

const verify: Command = {
  type: 'prompt',
  name: 'verify',
  description:
    'Spawn the verification subagent on the current state. Returns a ' +
    'structured PASS / FAIL / PARTIAL verdict with evidence.',
  progressMessage: 'verifying',
  contentLength: 350,
  source: 'builtin',
  argNames: ['focus'],
  async getPromptForCommand(args: string): Promise<ContentBlockParam[]> {
    return [{ type: 'text', text: VERIFY_PROMPT(args.trim()) }]
  },
}

export default verify
