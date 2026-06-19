const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

function diffsRoot(root) {
  return path.join(root, '.ur', 'ide', 'diffs')
}

function manifestPath(root) {
  return path.join(diffsRoot(root), 'manifest.json')
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function loadManifest(root) {
  const manifest = readJson(manifestPath(root), { version: 1, diffs: [] })
  return Array.isArray(manifest.diffs) ? manifest : { version: 1, diffs: [] }
}

function patchPath(root, bundle) {
  return path.join(diffsRoot(root), bundle.patchFile)
}

function metadataPath(root, bundle) {
  return path.join(diffsRoot(root), bundle.metadataFile)
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

class DiffItem extends vscode.TreeItem {
  constructor(bundle) {
    super(`${bundle.id}: ${bundle.title}`, vscode.TreeItemCollapsibleState.None)
    this.bundle = bundle
    this.contextValue = 'diff'
    this.description = `${bundle.status} · ${bundle.files?.length ?? 0} file(s)`
    this.tooltip = `${bundle.title}\n${bundle.patchFile}`
    this.command = {
      command: 'urInlineDiffs.open',
      title: 'Open Inline Diff',
      arguments: [this],
    }
  }
}

class DiffProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter()
    this.onDidChangeTreeData = this._onDidChangeTreeData.event
  }

  refresh() {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(item) {
    return item
  }

  getChildren() {
    const root = workspaceRoot()
    if (!root) return []
    return loadManifest(root)
      .diffs
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(bundle => new DiffItem(bundle))
  }
}

function renderDiffHtml(root, bundle) {
  const patch = fs.existsSync(patchPath(root, bundle))
    ? fs.readFileSync(patchPath(root, bundle), 'utf8')
    : ''
  const comments = bundle.comments ?? []
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font: 13px/1.45 var(--vscode-editor-font-family); color: var(--vscode-editor-foreground); padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { color: var(--vscode-descriptionForeground); margin-bottom: 14px; }
    pre { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); padding: 12px; overflow: auto; }
    .comments { margin-top: 18px; }
    .comment { border-top: 1px solid var(--vscode-panel-border); padding: 8px 0; }
    .where { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>${escapeHtml(bundle.title)}</h1>
  <div class="meta">${escapeHtml(bundle.id)} · ${escapeHtml(bundle.status)} · ${escapeHtml(bundle.files?.length ?? 0)} file(s)</div>
  <pre>${escapeHtml(patch)}</pre>
  <section class="comments">
    <h2>Comments</h2>
    ${comments.length === 0 ? '<p class="meta">No comments yet.</p>' : comments.map(comment => {
      const where = comment.file ? `${comment.file}${comment.line ? `:${comment.line}` : ''}` : 'General'
      return `<div class="comment"><div class="where">${escapeHtml(where)} · ${escapeHtml(comment.at ?? '')}</div><div>${escapeHtml(comment.text)}</div></div>`
    }).join('')}
  </section>
</body>
</html>`
}

async function openDiff(item) {
  const root = workspaceRoot()
  const bundle = item?.bundle
  if (!root || !bundle) {
    vscode.window.showWarningMessage('No UR inline diff selected.')
    return
  }
  const panel = vscode.window.createWebviewPanel(
    'urInlineDiff',
    `UR ${bundle.id}`,
    vscode.ViewColumn.Active,
    { enableScripts: false },
  )
  const latest = readJson(metadataPath(root, bundle), bundle)
  panel.webview.html = renderDiffHtml(root, latest)
}

async function commentDiff(item, provider) {
  const root = workspaceRoot()
  const bundle = item?.bundle
  if (!root || !bundle) {
    vscode.window.showWarningMessage('No UR inline diff selected.')
    return
  }
  const text = await vscode.window.showInputBox({
    title: `Comment on ${bundle.id}`,
    prompt: 'Comment text',
    ignoreFocusOut: true,
  })
  if (!text?.trim()) return

  const manifest = loadManifest(root)
  const manifestBundle = manifest.diffs.find(diff => diff.id === bundle.id)
  if (!manifestBundle) {
    vscode.window.showErrorMessage(`UR inline diff not found: ${bundle.id}`)
    return
  }
  const at = new Date().toISOString()
  const comment = { at, text: text.trim() }
  manifestBundle.status = 'commented'
  manifestBundle.updatedAt = at
  manifestBundle.comments = [...(manifestBundle.comments ?? []), comment]
  writeJson(manifestPath(root), manifest)
  writeJson(metadataPath(root, manifestBundle), manifestBundle)
  provider.refresh()
  vscode.window.showInformationMessage(`Added UR comment to ${bundle.id}.`)
}

function activate(context) {
  const provider = new DiffProvider()
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('urInlineDiffs', provider),
    vscode.commands.registerCommand('urInlineDiffs.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('urInlineDiffs.open', item => openDiff(item)),
    vscode.commands.registerCommand('urInlineDiffs.comment', item => commentDiff(item, provider)),
  )
}

function deactivate() {}

module.exports = { activate, deactivate }
