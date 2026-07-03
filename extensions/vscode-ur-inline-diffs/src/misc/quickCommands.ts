// Small, low-risk commands that round out the search quick-pick registry.
// Each does exactly one native/safe thing — no invented backend behavior.

import * as vscode from 'vscode'
import type { ChatController } from '../chat/chatController.js'
import { buildRunSpecPrompt, buildRunWorkflowPrompt } from '../chat/prompts.js'
import { workspaceRoot } from '../diffs/store.js'

const UR_DOCS_URL = 'https://github.com/Maitham16/UR#readme'

export async function openSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', 'UR')
}

export async function openDocs(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(UR_DOCS_URL))
}

export async function openArtifacts(): Promise<void> {
  const root = workspaceRoot()
  if (!root) {
    vscode.window.showWarningMessage('Open a workspace folder to view UR artifacts.')
    return
  }
  const uri = vscode.Uri.joinPath(vscode.Uri.file(root), '.ur')
  try {
    await vscode.commands.executeCommand('revealInExplorer', uri)
  } catch {
    vscode.window.showInformationMessage('No .ur directory yet — it is created the first time UR runs in this workspace.')
  }
}

export async function runSpecAction(chat: ChatController): Promise<void> {
  await chat.runStructuredPrompt(buildRunSpecPrompt())
}

export async function runWorkflowAction(chat: ChatController): Promise<void> {
  await chat.runStructuredPrompt(buildRunWorkflowPrompt())
}
