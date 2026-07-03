// File/selection context for the chat panel. The capture step (reading
// vscode.window.activeTextEditor) is the only impure part of this module and
// is deliberately kept to one small function — everything else is plain data
// in, plain data/string out, so it is testable without a VS Code host.
//
// `vscode` is required lazily inside captureEditorSnapshot() (not imported
// at module scope) specifically so this file can be loaded by `bun test`
// without a VS Code host present — a top-level `import ... from 'vscode'`
// would fail module resolution outside the extension host.

import * as path from 'node:path'
import type * as VscodeNamespace from 'vscode'

export interface ActiveFileSnapshot {
  /** Workspace-relative when a workspace is open, absolute otherwise. */
  path: string
  languageId: string
}

export interface SelectionSnapshot {
  path: string
  languageId: string
  /** 1-based, inclusive. */
  startLine: number
  endLine: number
  text: string
}

export interface EditorSnapshot {
  workspaceRoot?: string
  activeFile?: ActiveFileSnapshot
  selection?: SelectionSnapshot
}

export type ContextAttachment =
  | { kind: 'file'; file: ActiveFileSnapshot }
  | { kind: 'selection'; selection: SelectionSnapshot }

export function formatAttachmentLabel(attachment: ContextAttachment): string {
  if (attachment.kind === 'file') return `@${attachment.file.path}`
  const { path: filePath, startLine, endLine } = attachment.selection
  return startLine === endLine ? `@${filePath}:${startLine}` : `@${filePath}:${startLine}-${endLine}`
}

export function formatAttachmentBlock(attachment: ContextAttachment): string {
  const label = formatAttachmentLabel(attachment)
  if (attachment.kind === 'file') return label
  const fence = languageIdToFence(attachment.selection.languageId)
  return `${label}\n\`\`\`${fence}\n${attachment.selection.text}\n\`\`\``
}

/** Prepends attachment blocks to a user-authored prompt. Only ever called
 * with attachments the user explicitly staged via an Add-to-Chat/editor
 * action command — nothing in this module reads files on its own. */
export function buildPromptWithAttachments(prompt: string, attachments: ContextAttachment[]): string {
  if (attachments.length === 0) return prompt
  const blocks = attachments.map(formatAttachmentBlock).join('\n\n')
  return `${blocks}\n\n${prompt}`
}

/** Human-readable reason a requested attachment isn't available right now,
 * or null when it is. Callers use this to show a clear warning instead of
 * silently no-oping or attaching nothing. */
export function describeUnavailableReason(snapshot: EditorSnapshot, kind: 'file' | 'selection'): string | null {
  if (!snapshot.workspaceRoot) return 'Open a workspace folder first.'
  if (!snapshot.activeFile) return 'No active editor.'
  if (kind === 'selection' && !snapshot.selection) return 'No text selected.'
  return null
}

const FENCE_OVERRIDES: Record<string, string> = {
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
  shellscript: 'bash',
  jsonc: 'json',
  plaintext: '',
}

function languageIdToFence(languageId: string): string {
  return FENCE_OVERRIDES[languageId] ?? languageId
}

// ---------------------------------------------------------------------------
// vscode-dependent capture. Not unit tested directly — kept intentionally
// thin so the untested surface area is as small as possible.
// ---------------------------------------------------------------------------

export function captureEditorSnapshot(): EditorSnapshot {
  const vscode = require('vscode') as typeof VscodeNamespace
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const editor = vscode.window.activeTextEditor
  if (!editor) return { workspaceRoot }

  const absolutePath = editor.document.uri.fsPath
  const relativePath = workspaceRoot ? path.relative(workspaceRoot, absolutePath) : absolutePath
  const activeFile: ActiveFileSnapshot = { path: relativePath, languageId: editor.document.languageId }

  const selection = editor.selection
  if (selection.isEmpty) return { workspaceRoot, activeFile }

  const text = editor.document.getText(selection)
  const selectionSnapshot: SelectionSnapshot = {
    path: relativePath,
    languageId: editor.document.languageId,
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
    text,
  }
  return { workspaceRoot, activeFile, selection: selectionSnapshot }
}
