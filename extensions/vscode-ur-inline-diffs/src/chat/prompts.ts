// Structured prompt builders for the editor actions (Explain/Fix/Generate
// Tests). Pure string builders only — sending happens through the same
// chatController.sendMessage() path a typed message uses, no separate
// backend logic.

import { buildPromptWithAttachments, type ContextAttachment, type SelectionSnapshot } from '../context/ideContext.js'

function selectionAttachment(selection: SelectionSnapshot): ContextAttachment {
  return { kind: 'selection', selection }
}

export function buildExplainPrompt(selection: SelectionSnapshot): string {
  return buildPromptWithAttachments(
    'Explain what this code does, step by step. Call out any non-obvious behavior, edge cases, or assumptions it makes.',
    [selectionAttachment(selection)],
  )
}

export function buildFixPrompt(selection: SelectionSnapshot): string {
  return buildPromptWithAttachments(
    'Find and fix any bugs in this code. Explain what was wrong and what you changed.',
    [selectionAttachment(selection)],
  )
}

export function buildGenerateTestsPrompt(selection: SelectionSnapshot): string {
  return buildPromptWithAttachments(
    'Write tests for this code, covering the main behavior and realistic edge cases. Match the existing test style and framework used in this project if you can tell what it is.',
    [selectionAttachment(selection)],
  )
}

// `ur spec`/`ur workflow` are full agentic commands (init/list/run/verify/...),
// not quick read-only CLI lookups, so these hand off to the agent through
// chat rather than the extension guessing flags and shelling out directly.

export function buildRunSpecPrompt(): string {
  return 'List the specs in this project (.ur/specs, via `ur spec list`) and help me run the next pending task. If none exist yet, help me scaffold one with `ur spec init`.'
}

export function buildRunWorkflowPrompt(): string {
  return 'List the workflows available in this project (`ur workflow list`) and help me run the appropriate one for my current task.'
}
