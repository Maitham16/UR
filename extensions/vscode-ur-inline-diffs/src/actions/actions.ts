import * as vscode from 'vscode'
import type { BackgroundTaskItem } from './actionsTreeProvider.js'

export async function openBackgroundLog(item: BackgroundTaskItem | undefined): Promise<void> {
  const logFile = item?.task.logFile
  if (!logFile) {
    vscode.window.showWarningMessage('No log file for this background task.')
    return
  }
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(logFile))
    await vscode.window.showTextDocument(doc, { preview: true })
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not open background task log: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
