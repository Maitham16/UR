// Agent status card webview. Full-HTML-replace on refresh (no incremental
// DOM patching) — this view is read-mostly, so there's no need for the
// chat panel's postMessage-diff approach.

import * as vscode from 'vscode'
import type { AgentStatus, KnownOrUnknown } from '../bridge/types.js'
import { escapeHtml } from '../util/format.js'
import { assembleAgentStatus } from './statusData.js'

function knownText(value: KnownOrUnknown<boolean | string>): string {
  if (value === 'unknown') return 'unknown'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function row(label: string, value: string): string {
  return `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`
}

function renderStatusHtml(status: AgentStatus): string {
  const acp = status.acp.running ? `running on ${status.acp.host}:${status.acp.port}` : 'not running'
  const warnings =
    status.warnings.length === 0
      ? '<p class="meta">No warnings.</p>'
      : `<ul>${status.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
  const boundary = status.provider.safetyBoundaryLabel
    ? row('Safety boundary', status.provider.safetyBoundaryLabel)
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.5 var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; margin: 0; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .label { color: var(--vscode-descriptionForeground); }
  .value { text-align: right; word-break: break-word; }
  section { margin-top: 20px; }
  h2 { font-size: 13px; margin: 0 0 8px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.04em; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .meta { color: var(--vscode-descriptionForeground); }
  ul { margin: 4px 0 0; padding-left: 18px; }
</style>
</head>
<body>
  <h1>UR Agent Status</h1>
  ${row('UR version', status.urVersion)}
  ${row('Workspace root', status.workspaceRoot)}
  ${row('Provider', status.provider.label)}
  ${row('Model', status.provider.model ?? '(none selected)')}
  ${row('Provider kind', knownText(status.provider.providerKind))}
  ${row('Uses external CLI', knownText(status.provider.usesExternalCli))}
  ${row('Native tool-call support', knownText(status.provider.supportsNativeToolCalls))}
  ${row('Native streaming support', knownText(status.provider.supportsNativeStreaming))}
  ${row('Multimodal support', knownText(status.provider.multimodal))}
  ${boundary}
  ${row('Sandbox mode', knownText(status.sandboxMode))}
  ${row('Verifier mode', knownText(status.verifierMode))}
  ${row('ACP server', acp)}
  ${row('Plugins loaded', String(status.pluginCount))}
  <section>
    <h2>Warnings</h2>
    ${warnings}
  </section>
  <section>
    <button id="refresh">Refresh</button>
  </section>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  </script>
</body>
</html>`
}

function renderLoadingHtml(): string {
  return `<!doctype html><html><body style="font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground);"><p>Loading UR agent status…</p></body></html>`
}

export class StatusPanel {
  private static current: StatusPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private disposed = false

  private constructor(panel: vscode.WebviewPanel, onRefresh: () => void) {
    this.panel = panel
    this.panel.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type === 'refresh') onRefresh()
    })
    this.panel.onDidDispose(() => {
      this.disposed = true
      if (StatusPanel.current === this) StatusPanel.current = undefined
    })
  }

  static createOrShow(onRefresh: () => void): StatusPanel {
    if (StatusPanel.current && !StatusPanel.current.disposed) {
      StatusPanel.current.panel.reveal(vscode.ViewColumn.Active)
      return StatusPanel.current
    }
    const panel = vscode.window.createWebviewPanel('urAgentStatus', 'UR Agent Status', vscode.ViewColumn.Active, {
      enableScripts: true,
    })
    const instance = new StatusPanel(panel, onRefresh)
    StatusPanel.current = instance
    return instance
  }

  render(status: AgentStatus): void {
    if (this.disposed) return
    this.panel.webview.html = renderStatusHtml(status)
  }

  renderLoading(): void {
    if (this.disposed) return
    this.panel.webview.html = renderLoadingHtml()
  }
}

export async function showAgentStatus(cwd: string | undefined): Promise<void> {
  if (!cwd) {
    vscode.window.showWarningMessage('Open a workspace folder to view UR agent status.')
    return
  }
  let panel: StatusPanel | undefined
  const refresh = async (): Promise<void> => {
    if (!panel) return
    panel.renderLoading()
    const status = await assembleAgentStatus(cwd)
    panel.render(status)
  }
  panel = StatusPanel.createOrShow(() => void refresh())
  await refresh()
}
