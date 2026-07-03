import * as vscode from 'vscode'
import { openBackgroundLog } from './actions/actions.js'
import { ActionsTreeProvider } from './actions/actionsTreeProvider.js'
import { ChatController } from './chat/chatController.js'
import { ChatTreeProvider } from './chat/chatTreeProvider.js'
import { applyDiff, commentDiff, rejectDiff, showStatus, type Refreshable } from './diffs/actions.js'
import { DiffTreeProvider } from './diffs/treeProvider.js'
import { openDiff } from './diffs/webview.js'
import { pickProviderModel } from './model/modelPicker.js'
import { openArtifacts, openDocs, openSettings, runSpecAction, runWorkflowAction } from './misc/quickCommands.js'
import { showAgentOptions } from './options/agentOptionsPanel.js'
import { reviewCurrentDiff } from './review/reviewDiff.js'
import { showSearchActions } from './search/searchQuickPick.js'
import { showAgentStatus } from './status/statusPanel.js'
import { runVerifier } from './verify/runVerifier.js'
import { workspaceRoot } from './diffs/store.js'

export function activate(context: vscode.ExtensionContext): void {
  const diffTreeProvider = new DiffTreeProvider()
  const actionsTreeProvider = new ActionsTreeProvider()
  const channel = vscode.window.createOutputChannel('UR')
  const chat = new ChatController()
  const chatTreeProvider = new ChatTreeProvider(chat)
  const chatTree = vscode.window.createTreeView('urChat', {
    treeDataProvider: chatTreeProvider,
    showCollapseAll: false,
  })
  const diffTree = vscode.window.createTreeView('urInlineDiffs', {
    treeDataProvider: diffTreeProvider,
    showCollapseAll: false,
  })
  const actionsTree = vscode.window.createTreeView('urActions', {
    treeDataProvider: actionsTreeProvider,
    showCollapseAll: false,
  })

  // Diff bundles are shown in both the PR1 inline diff tree and the new
  // actions panel — keep both in sync after any mutating action regardless
  // of which view it was triggered from.
  const bothDiffViews: Refreshable = {
    refresh: () => {
      diffTreeProvider.refresh()
      actionsTreeProvider.refresh()
    },
  }

  context.subscriptions.push(
    channel,
    chatTree,
    diffTree,
    actionsTree,
    chat,
    chat.onDidChangeState(() => chatTreeProvider.refresh()),
    vscode.window.onDidChangeActiveTextEditor(() => chatTreeProvider.refresh()),
    vscode.window.onDidChangeTextEditorSelection(() => chatTreeProvider.refresh()),
    vscode.commands.registerCommand('urInlineDiffs.refresh', () => diffTreeProvider.refresh()),
    vscode.commands.registerCommand('urInlineDiffs.open', item => openDiff(item)),
    vscode.commands.registerCommand('urInlineDiffs.comment', item => commentDiff(item, bothDiffViews)),
    vscode.commands.registerCommand('urInlineDiffs.apply', item => applyDiff(item, bothDiffViews)),
    vscode.commands.registerCommand('urInlineDiffs.reject', item => rejectDiff(item, bothDiffViews)),
    vscode.commands.registerCommand('urInlineDiffs.status', () => showStatus(channel)),
    vscode.commands.registerCommand('urInlineDiffs.chat.new', () => chat.newChat()),
    vscode.commands.registerCommand('urInlineDiffs.chat.open', () => chat.openChat()),
    vscode.commands.registerCommand('urInlineDiffs.chat.cancel', () => chat.cancelCurrentRequest()),
    vscode.commands.registerCommand('urInlineDiffs.chat.addFile', () => chat.addCurrentFileToChat()),
    vscode.commands.registerCommand('urInlineDiffs.chat.addSelection', () => chat.addSelectionToChat()),
    vscode.commands.registerCommand('urInlineDiffs.chat.explainSelection', () => chat.explainSelection()),
    vscode.commands.registerCommand('urInlineDiffs.chat.fixSelection', () => chat.fixSelection()),
    vscode.commands.registerCommand('urInlineDiffs.chat.generateTests', () => chat.generateTestsForSelection()),
    vscode.commands.registerCommand('urInlineDiffs.agentStatus', () => showAgentStatus(workspaceRoot())),
    vscode.commands.registerCommand('urInlineDiffs.agentOptions', () => showAgentOptions(workspaceRoot())),
    vscode.commands.registerCommand('urInlineDiffs.reviewCurrentDiff', () => reviewCurrentDiff(chat)),
    vscode.commands.registerCommand('urInlineDiffs.runVerifier', () => runVerifier(chat)),
    vscode.commands.registerCommand('urInlineDiffs.searchActions', () => showSearchActions()),
    vscode.commands.registerCommand('urInlineDiffs.pickModel', () => pickProviderModel(workspaceRoot())),
    vscode.commands.registerCommand('urInlineDiffs.openSettings', () => openSettings()),
    vscode.commands.registerCommand('urInlineDiffs.openDocs', () => openDocs()),
    vscode.commands.registerCommand('urInlineDiffs.openArtifacts', () => openArtifacts()),
    vscode.commands.registerCommand('urInlineDiffs.runSpec', () => runSpecAction(chat)),
    vscode.commands.registerCommand('urInlineDiffs.runWorkflow', () => runWorkflowAction(chat)),
    vscode.commands.registerCommand('urActions.refresh', () => actionsTreeProvider.refresh()),
    vscode.commands.registerCommand('urActions.openBackgroundLog', item => openBackgroundLog(item)),
  )
}

export function deactivate(): void {}
