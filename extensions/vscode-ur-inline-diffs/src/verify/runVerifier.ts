// "UR: Run Verifier" — opens chat and asks UR to run its real verification
// subagent. Failures surface through ChatController's existing error banner
// (handleTurnExit), so a non-zero UR exit is never reported as success.

import * as vscode from 'vscode'
import type { ChatController } from '../chat/chatController.js'
import { workspaceRoot } from '../diffs/store.js'
import { buildVerifierPrompt } from './verifierPrompt.js'

export async function runVerifier(chat: ChatController): Promise<void> {
  const root = workspaceRoot()
  if (!root) {
    vscode.window.showWarningMessage('Open a workspace folder to run the UR verifier.')
    return
  }
  await chat.runStructuredPrompt(buildVerifierPrompt())
}
