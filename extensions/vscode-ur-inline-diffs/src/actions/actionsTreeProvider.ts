// Unified actions view: existing IDE diff bundles (reusing diffs/store.ts +
// diffs/treeProvider.ts's DiffTreeItem so open/apply/reject/comment keep
// working unchanged) plus background tasks from `ur bg list --json`. This is
// a second, additive view — it does not replace the PR1 inline diff tree.

import * as vscode from 'vscode'
import type { BackgroundTaskStatus, BackgroundTaskSummary } from '../bridge/types.js'
import { loadManifest, workspaceRoot } from '../diffs/store.js'
import { DiffTreeItem } from '../diffs/treeProvider.js'
import { loadBackgroundTasks } from './background.js'

function backgroundStatusIcon(status: BackgroundTaskStatus): vscode.ThemeIcon {
  switch (status) {
    case 'completed':
      return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
    case 'failed':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
    case 'canceled':
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.yellow'))
    case 'running':
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'))
    default:
      return new vscode.ThemeIcon('clock')
  }
}

export class BackgroundTaskItem extends vscode.TreeItem {
  readonly task: BackgroundTaskSummary

  constructor(task: BackgroundTaskSummary) {
    super(task.task, vscode.TreeItemCollapsibleState.None)
    this.task = task
    this.contextValue = 'backgroundTask'
    this.description = task.status
    this.iconPath = backgroundStatusIcon(task.status)
    this.tooltip = `${task.id} — ${task.status}${task.logFile ? `\n${task.logFile}` : ''}`
    if (task.logFile) {
      this.command = { command: 'urActions.openBackgroundLog', title: 'Open Log', arguments: [this] }
    }
  }
}

export class SectionItem extends vscode.TreeItem {
  constructor(
    readonly kind: 'diffs' | 'background',
    label: string,
    count: number,
  ) {
    super(label, count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None)
    this.description = String(count)
    this.contextValue = 'urActionsSection'
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(label: string, description: string, icon = 'info') {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.contextValue = 'urInfo'
    this.description = description
    this.iconPath = new vscode.ThemeIcon(icon)
    this.tooltip = `${label}${description ? ` — ${description}` : ''}`
  }
}

export type ActionsNode = SectionItem | DiffTreeItem | BackgroundTaskItem | InfoItem

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionsNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private diffs: ReturnType<typeof loadManifest>['diffs'] = []
  private backgroundTasks: BackgroundTaskSummary[] = []
  private loaded = false

  refresh(): void {
    this.loaded = false
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(item: ActionsNode): vscode.TreeItem {
    return item
  }

  async getChildren(element?: ActionsNode): Promise<ActionsNode[]> {
    const root = workspaceRoot()
    if (!root) {
      return [new InfoItem('Open a workspace folder', 'UR actions are scoped to the active project', 'folder-opened')]
    }

    if (!this.loaded) {
      this.diffs = loadManifest(root).diffs
      this.backgroundTasks = await loadBackgroundTasks(root)
      this.loaded = true
    }

    if (!element) {
      if (this.diffs.length === 0 && this.backgroundTasks.length === 0) {
        return []
      }
      return [
        new SectionItem('diffs', 'Diff Bundles', this.diffs.length),
        new SectionItem('background', 'Background Tasks', this.backgroundTasks.length),
      ]
    }

    if (element instanceof SectionItem && element.kind === 'diffs') {
      if (this.diffs.length === 0) {
        return [new InfoItem('No diff bundles', 'Captured review bundles will appear here', 'diff')]
      }
      return this.diffs
        .slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(bundle => new DiffTreeItem(bundle))
    }

    if (element instanceof SectionItem && element.kind === 'background') {
      if (this.backgroundTasks.length === 0) {
        return [new InfoItem('No background tasks', 'Tasks started with `ur bg run` will appear here', 'circle-outline')]
      }
      return this.backgroundTasks.map(task => new BackgroundTaskItem(task))
    }

    return []
  }
}
