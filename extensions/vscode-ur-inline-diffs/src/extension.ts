import * as vscode from 'vscode'
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
  context.subscriptions.push(
    channel,
    tree,
    vscode.commands.registerCommand('urInlineDiffs.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('urInlineDiffs.open', item => openDiff(item)),
    vscode.commands.registerCommand('urInlineDiffs.comment', item => commentDiff(item, provider)),
    vscode.commands.registerCommand('urInlineDiffs.apply', item => applyDiff(item, provider)),
    vscode.commands.registerCommand('urInlineDiffs.reject', item => rejectDiff(item, provider)),
    vscode.commands.registerCommand('urInlineDiffs.status', () => showStatus(channel)),
  )
}

export function deactivate(): void {}
