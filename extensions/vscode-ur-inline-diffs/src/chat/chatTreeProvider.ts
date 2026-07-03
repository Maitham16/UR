import * as vscode from 'vscode'
import { captureEditorSnapshot } from '../context/ideContext.js'
import type { ChatController } from './chatController.js'

class ActionItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: string,
    command: vscode.Command,
    tooltip?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.contextValue = 'urChatAction'
    this.description = description
    this.iconPath = new vscode.ThemeIcon(icon)
    this.tooltip = tooltip ?? `${label}${description ? ` - ${description}` : ''}`
    this.command = command
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(label: string, description: string, icon = 'comment-discussion') {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.contextValue = 'urInfo'
    this.description = description
    this.iconPath = new vscode.ThemeIcon(icon)
    this.tooltip = `${label}${description ? ` - ${description}` : ''}`
  }
}

export type ChatTreeNode = ActionItem | InfoItem

export class ChatTreeProvider implements vscode.TreeDataProvider<ChatTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor(private readonly chat: ChatController) {}

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(item: ChatTreeNode): vscode.TreeItem {
    return item
  }

  getChildren(): ChatTreeNode[] {
    const snapshot = captureEditorSnapshot()
    const items: ChatTreeNode[] = [
      new InfoItem('Start a UR chat', 'Ask about this workspace or attach editor context.'),
      new ActionItem('New Chat', 'Start a fresh UR session', 'comment-add', {
        command: 'urInlineDiffs.chat.new',
        title: 'New Chat',
      }),
      new ActionItem('Open Chat', 'Resume an existing session', 'comment', {
        command: 'urInlineDiffs.chat.open',
        title: 'Open Chat',
      }),
      new ActionItem('Pick Model', 'Choose provider and model', 'symbol-variable', {
        command: 'urInlineDiffs.pickModel',
        title: 'Pick Model',
      }),
    ]

    if (snapshot.activeFile) {
      items.push(
        new ActionItem('Add Current File to Chat', snapshot.activeFile.path, 'file-add', {
          command: 'urInlineDiffs.chat.addFile',
          title: 'Add Current File to Chat',
        }),
      )
    }

    if (snapshot.selection) {
      const lineRange =
        snapshot.selection.startLine === snapshot.selection.endLine
          ? `${snapshot.selection.path}:${snapshot.selection.startLine}`
          : `${snapshot.selection.path}:${snapshot.selection.startLine}-${snapshot.selection.endLine}`
      items.push(
        new ActionItem('Add Selection to Chat', lineRange, 'selection', {
          command: 'urInlineDiffs.chat.addSelection',
          title: 'Add Selection to Chat',
        }),
      )
    }

    if (this.chat.isRequestRunning()) {
      items.push(
        new ActionItem('Cancel Current Chat Request', 'Stop the running request', 'stop-circle', {
          command: 'urInlineDiffs.chat.cancel',
          title: 'Cancel Current Chat Request',
        }),
      )
    }

    return items
  }
}
