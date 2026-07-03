// "UR: Review Current Diff" — captures the working tree's current diff
// through a direct, argv-array `git diff` call (no shell), confirms before
// sending anything large, then hands a structured prompt to the same chat
// pathway every other UR turn goes through. Never uploads file content
// silently — the command itself, plus the size confirmation, are the only
// two ways this text reaches UR.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import type { ChatController } from '../chat/chatController.js'
import { workspaceRoot } from '../diffs/store.js'
import { processErrorMessage } from '../util/format.js'
import { buildReviewPrompt, LARGE_DIFF_THRESHOLD } from './reviewPrompt.js'

const execFileAsync = promisify(execFile)

export async function captureGitDiff(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], { cwd, shell: false })
  return stdout
}

export async function reviewCurrentDiff(chat: ChatController): Promise<void> {
  const root = workspaceRoot()
  if (!root) {
    vscode.window.showWarningMessage('Open a workspace folder to review a diff.')
    return
  }

  let diff: string
  try {
    diff = await captureGitDiff(root)
  } catch (error) {
    vscode.window.showErrorMessage(`Could not read the current git diff: ${processErrorMessage(error)}`)
    return
  }

  if (!diff.trim()) {
    vscode.window.showInformationMessage('No changes to review (working tree matches HEAD).')
    return
  }

  if (diff.length > LARGE_DIFF_THRESHOLD) {
    const choice = await vscode.window.showWarningMessage(
      `The current diff is large (${diff.length.toLocaleString()} characters). Send it to UR for review?`,
      { modal: true },
      'Send',
    )
    if (choice !== 'Send') return
  }

  await chat.runStructuredPrompt(buildReviewPrompt(diff))
}
