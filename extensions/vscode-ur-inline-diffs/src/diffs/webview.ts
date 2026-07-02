import * as vscode from 'vscode'
import type { DiffArtifact } from '../bridge/types.js'
import { escapeHtml, formatCount, formatRelativeTime } from '../util/format.js'
import type { DiffTreeItem } from './treeProvider.js'
import { loadBundleMetadata, readPatch, workspaceRoot } from './store.js'

function renderDiffHtml(root: string, bundle: DiffArtifact): string {
  const patch = readPatch(root, bundle)
  const comments = bundle.comments ?? []
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; }
    body { font: 13px/1.5 var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; margin: 0; }
    header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 14px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 6px; }
    h2 { font-size: 14px; margin: 20px 0 10px; }
    .meta, .where { color: var(--vscode-descriptionForeground); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .chip { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 3px 8px; background: var(--vscode-sideBar-background); }
    pre { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 14px; overflow: auto; font-family: var(--vscode-editor-font-family); }
    .comments { margin-top: 18px; }
    .comment { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; background: var(--vscode-sideBar-background); }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(bundle.title)}</h1>
    <div class="meta">${escapeHtml(bundle.id)} · ${escapeHtml(formatRelativeTime(bundle.updatedAt ?? bundle.createdAt))}</div>
    <div class="chips">
      <span class="chip">${escapeHtml(bundle.status ?? 'captured')}</span>
      <span class="chip">${escapeHtml(formatCount(bundle.files?.length ?? 0, 'file'))}</span>
      <span class="chip">${escapeHtml(formatCount(comments.length, 'comment'))}</span>
    </div>
  </header>
  <pre>${escapeHtml(patch)}</pre>
  <section class="comments">
    <h2>Comments</h2>
    ${
      comments.length === 0
        ? '<p class="meta">No comments yet.</p>'
        : comments
            .map(comment => {
              const where = comment.file ? `${comment.file}${comment.line ? `:${comment.line}` : ''}` : 'General'
              return `<div class="comment"><div class="where">${escapeHtml(where)} · ${escapeHtml(comment.at ?? '')}</div><div>${escapeHtml(comment.text)}</div></div>`
            })
            .join('')
    }
  </section>
</body>
</html>`
}

export async function openDiff(item: DiffTreeItem | undefined): Promise<void> {
  const root = workspaceRoot()
  const bundle = item?.bundle
  if (!root || !bundle) {
    vscode.window.showWarningMessage('No UR inline diff selected.')
    return
  }
  const panel = vscode.window.createWebviewPanel('urInlineDiff', `UR ${bundle.id}`, vscode.ViewColumn.Active, {
    enableScripts: false,
  })
  const latest = loadBundleMetadata(root, bundle)
  panel.webview.html = renderDiffHtml(root, latest)
}
