import * as vscode from 'vscode'
import { ChatController } from './chat/chatController.js'
import { applyDiff, commentDiff, rejectDiff, showStatus } from './diffs/actions.js'
import { DiffTreeProvider } from './diffs/treeProvider.js'
import { openDiff } from './diffs/webview.js'

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DiffTreeProvider()
  const channel = vscode.window.createOutputChannel('UR')
  const tree = vscode.window.createTreeView('urInlineDiffs', {
    treeDataProvider: provider,
    showCollapseAll: false,
  })
  const chat = new ChatController()
  context.subscriptions.push(
    channel,
    tree,
    chat,
    vscode.commands.registerCommand('urInlineDiffs.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('urInlineDiffs.open', item => openDiff(item)),
    vscode.commands.registerCommand('urInlineDiffs.comment', item => commentDiff(item, provider)),
    vscode.commands.registerCommand('urInlineDiffs.apply', item => applyDiff(item, provider)),
    vscode.commands.registerCommand('urInlineDiffs.reject', item => rejectDiff(item, provider)),
    vscode.commands.registerCommand('urInlineDiffs.status', () => showStatus(channel)),
    vscode.commands.registerCommand('urInlineDiffs.chat.new', () => chat.newChat()),
    vscode.commands.registerCommand('urInlineDiffs.chat.open', () => chat.openChat()),
    vscode.commands.registerCommand('urInlineDiffs.chat.cancel', () => chat.cancelCurrentRequest()),
    vscode.commands.registerCommand('urInlineDiffs.chat.addFile', () => chat.addCurrentFileToChat()),
    vscode.commands.registerCommand('urInlineDiffs.chat.addSelection', () => chat.addSelectionToChat()),
    vscode.commands.registerCommand('urInlineDiffs.chat.explainSelection', () => chat.explainSelection()),
    vscode.commands.registerCommand('urInlineDiffs.chat.fixSelection', () => chat.fixSelection()),
    vscode.commands.registerCommand('urInlineDiffs.chat.generateTests', () => chat.generateTestsForSelection()),
  )
}

export function deactivate(): void {}
