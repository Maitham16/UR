// Agent Options webview: local/curated recommendations layered over the
// real `ur provider list --json` catalog. Full-HTML-replace on refresh, same
// approach as the status card.

import * as vscode from 'vscode'
import type { CategoryRecommendation, ProviderOption } from '../bridge/types.js'
import { escapeHtml } from '../util/format.js'
import { buildRecommendations } from './agentOptions.js'
import { loadProviderOptions } from './providerOptionsLoader.js'

function knownText(value: unknown): string {
  if (value === 'unknown') return 'unknown'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function displayNameFor(options: ProviderOption[], id: string): string {
  return options.find(o => o.id === id)?.displayName ?? id
}

function renderProviderTable(options: ProviderOption[]): string {
  if (options.length === 0) return '<p class="meta">No providers found. Is the UR CLI on PATH?</p>'
  const rows = options
    .map(
      o =>
        `<tr><td>${escapeHtml(o.displayName)}</td><td>${escapeHtml(o.providerKind)}</td><td>${escapeHtml(o.accessType)}</td><td>${escapeHtml(knownText(o.multimodal))}</td></tr>`,
    )
    .join('')
  return `<table><thead><tr><th>Provider</th><th>Provider kind</th><th>Access type</th><th>Multimodal</th></tr></thead><tbody>${rows}</tbody></table>`
}

function renderCategory(options: ProviderOption[], rec: CategoryRecommendation): string {
  const names =
    rec.recommendedProviderIds.length > 0
      ? rec.recommendedProviderIds.map(id => escapeHtml(displayNameFor(options, id))).join(', ')
      : '(no provider structurally favored)'
  const caveat = rec.caveat ? `<p class="caveat">${escapeHtml(rec.caveat)}</p>` : ''
  return `<section class="category">
    <h3>${escapeHtml(rec.title)}</h3>
    <p>${escapeHtml(rec.rationale)}</p>
    <p class="recommend"><strong>Recommended:</strong> ${names}</p>
    ${caveat}
  </section>`
}

function renderOptionsHtml(options: ProviderOption[]): string {
  const recommendations = buildRecommendations(options)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.6 var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; margin: 0; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 6px; }
  h2 { font-size: 13px; margin: 20px 0 8px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.04em; }
  .disclaimer { color: var(--vscode-descriptionForeground); border-left: 3px solid var(--vscode-textBlockQuote-border); padding: 8px 12px; margin-bottom: 20px; background: var(--vscode-textBlockQuote-background); }
  table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; }
  .category { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px 16px; margin-bottom: 14px; }
  .category h3 { margin: 0 0 6px; font-size: 13px; }
  .recommend { margin: 8px 0 0; }
  .caveat { color: var(--vscode-descriptionForeground); font-style: italic; margin: 8px 0 0; }
  .meta { color: var(--vscode-descriptionForeground); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <h1>UR Agent Options</h1>
  <p class="disclaimer">Based on local, curated data and the UR CLI's own provider registry only. This is not live market research and does not rank model quality.</p>
  <h2>Providers</h2>
  ${renderProviderTable(options)}
  <h2>Recommendations</h2>
  ${recommendations.map(rec => renderCategory(options, rec)).join('')}
  <button id="refresh">Refresh</button>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  </script>
</body>
</html>`
}

function renderLoadingHtml(): string {
  return `<!doctype html><html><body style="font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground);"><p>Loading UR agent options…</p></body></html>`
}

export class AgentOptionsPanel {
  private static current: AgentOptionsPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private disposed = false

  private constructor(panel: vscode.WebviewPanel, onRefresh: () => void) {
    this.panel = panel
    this.panel.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type === 'refresh') onRefresh()
    })
    this.panel.onDidDispose(() => {
      this.disposed = true
      if (AgentOptionsPanel.current === this) AgentOptionsPanel.current = undefined
    })
  }

  static createOrShow(onRefresh: () => void): AgentOptionsPanel {
    if (AgentOptionsPanel.current && !AgentOptionsPanel.current.disposed) {
      AgentOptionsPanel.current.panel.reveal(vscode.ViewColumn.Active)
      return AgentOptionsPanel.current
    }
    const panel = vscode.window.createWebviewPanel('urAgentOptions', 'UR Agent Options', vscode.ViewColumn.Active, {
      enableScripts: true,
    })
    const instance = new AgentOptionsPanel(panel, onRefresh)
    AgentOptionsPanel.current = instance
    return instance
  }

  render(options: ProviderOption[]): void {
    if (this.disposed) return
    this.panel.webview.html = renderOptionsHtml(options)
  }

  renderLoading(): void {
    if (this.disposed) return
    this.panel.webview.html = renderLoadingHtml()
  }
}

export async function showAgentOptions(cwd: string | undefined): Promise<void> {
  if (!cwd) {
    vscode.window.showWarningMessage('Open a workspace folder to view UR agent options.')
    return
  }
  let panel: AgentOptionsPanel | undefined
  const refresh = async (): Promise<void> => {
    if (!panel) return
    panel.renderLoading()
    const options = await loadProviderOptions(cwd)
    panel.render(options)
  }
  panel = AgentOptionsPanel.createOrShow(() => void refresh())
  await refresh()
}
