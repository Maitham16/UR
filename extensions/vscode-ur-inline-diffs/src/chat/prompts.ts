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
