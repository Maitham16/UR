import * as vscode from 'vscode'
import type { DiffArtifact } from '../bridge/types.js'
import { escapeHtml, formatCount, formatRelativeTime } from '../util/format.js'
import { loadManifest, workspaceRoot } from './store.js'

function statusIcon(status: DiffArtifact['status'] | undefined): vscode.ThemeIcon {
  switch (status) {
    case 'approved':
      return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
    case 'rejected':
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconFailed'))
    case 'commented':
      return new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.yellow'))
    default:
      return new vscode.ThemeIcon('diff', new vscode.ThemeColor('charts.blue'))
  }
}

export class DiffTreeItem extends vscode.TreeItem {
  readonly bundle: DiffArtifact

  constructor(bundle: DiffArtifact) {
    const title = bundle.title || bundle.id
    super(title, vscode.TreeItemCollapsibleState.None)
    this.bundle = bundle
    this.contextValue = 'diff'
    const fileCount = bundle.files?.length ?? 0
    const changedAt = bundle.updatedAt ?? bundle.createdAt
    this.description = `${bundle.status ?? 'captured'} · ${formatCount(fileCount, 'file')} · ${formatRelativeTime(changedAt)}`
    this.iconPath = statusIcon(bundle.status)
    this.tooltip = new vscode.MarkdownString(
      [
        `**${escapeHtml(title)}**`,
        '',
        `- ID: \`${escapeHtml(bundle.id)}\``,
        `- Status: ${escapeHtml(bundle.status ?? 'captured')}`,
        `- Files: ${fileCount}`,
        `- Patch: \`${escapeHtml(bundle.patchFile)}\``,
      ].join('\n'),
    )
    this.command = {
      command: 'urInlineDiffs.open',
      title: 'Open Inline Diff',
      arguments: [this],
    }
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

export type DiffTreeNode = DiffTreeItem | InfoItem

export class DiffTreeProvider implements vscode.TreeDataProvider<DiffTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(item: DiffTreeNode): vscode.TreeItem {
    return item
  }

  getChildren(): DiffTreeNode[] {
    const root = workspaceRoot()
    if (!root) {
      return [
        new InfoItem(
          'Open a workspace folder',
          'UR inline diffs are scoped to the active project',
          'folder-opened',
        ),
      ]
    }

    const manifest = loadManifest(root)
    const diffs = manifest.diffs
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

    if (diffs.length === 0) {
      return []
    }

    return diffs.map(bundle => new DiffTreeItem(bundle))
  }
}
