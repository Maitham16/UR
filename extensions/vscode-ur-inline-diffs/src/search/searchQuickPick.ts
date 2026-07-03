import * as vscode from 'vscode'
import { ACTION_REGISTRY } from './actionRegistry.js'

export async function showSearchActions(): Promise<void> {
  type ActionQuickPickItem = vscode.QuickPickItem & { commandId: string }
  const items: ActionQuickPickItem[] = ACTION_REGISTRY.map(action => ({
    label: action.label,
    detail: action.description,
    commandId: action.commandId,
  }))
  const picked = await vscode.window.showQuickPick(items, {
    title: 'UR: Search Actions',
    placeHolder: 'Search UR actions',
    matchOnDetail: true,
  })
  if (!picked) return
  await vscode.commands.executeCommand(picked.commandId)
}
