/**
 * Local web page for artifacts: `ur artifacts serve` starts an HTTP server on
 * 127.0.0.1 that renders `.ur/artifacts/` — GET /artifacts/<id> shows one
 * artifact, / lists all, /diff shows live working-tree changes. Diff artifacts
 * render VS Code-style (side-by-side, syntax highlighted) via diff2html loaded
 * from CDN, with an escaped <pre> fallback when offline.
 */

import { createServer, type Server } from 'node:http'
import { escapeXmlAttr as escapeHtml } from '../../utils/xml.js'
import {
  captureDiff,
  getArtifact,
  getWorkingDiff,
  listArtifacts,
  readArtifactBody,
  type Artifact,
  type CommandExec,
} from './artifacts.js'

const STATUS_COLOR: Record<Artifact['status'], string> = {
  pending: '#b58900',
  approved: '#2aa15f',
  rejected: '#d94f4f',
}

const DIFF_VIEWER_HEAD = `
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css">
<script src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html-ui.min.js"></script>`

function page(title: string, body: string, head = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>${head}
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  a { color: #4078c0; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #8884; }
  pre { background: #8881; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  .badge { padding: .1rem .5rem; border-radius: 999px; color: #fff; font-size: .8rem; }
  .meta { color: #888; font-size: .9rem; }
  .feedback { border-left: 3px solid #8884; padding-left: .8rem; margin: .5rem 0; }
  .btn { display: inline-block; padding: .35rem .9rem; border: 1px solid #8886; border-radius: 6px; background: #8881; cursor: pointer; font-size: .9rem; color: inherit; }
  .btn:hover { background: #8882; }
  .toolbar { margin: .8rem 0; display: flex; gap: .5rem; align-items: center; }
</style>
</head>
<body>${body}</body>
</html>
`
}

function badge(status: Artifact['status']): string {
  return `<span class="badge" style="background:${STATUS_COLOR[status]}">${status}</span>`
}

function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function isDiffArtifact(artifact: Artifact): boolean {
  return artifact.kind === 'diff' || (artifact.file?.endsWith('.patch') ?? false)
}

function renderDiffBlock(diff: string): string {
  return `
<div class="toolbar" id="diff-toggle" style="display:none">
  <button class="btn" onclick="__drawDiff('side-by-side')">Side by side</button>
  <button class="btn" onclick="__drawDiff('line-by-line')">Inline</button>
</div>
<div id="diff-view"></div>
<pre id="diff-fallback">${escapeHtml(diff)}</pre>
<script>
(function () {
  var diff = ${jsString(diff)};
  window.__drawDiff = function (fmt) {
    if (typeof Diff2HtmlUI === 'undefined' || !diff.trim()) return;
    var ui = new Diff2HtmlUI(document.getElementById('diff-view'), diff, {
      outputFormat: fmt,
      drawFileList: true,
      matching: 'lines',
      highlight: true,
      colorScheme: 'auto',
    });
    ui.draw();
    ui.highlightCode();
    document.getElementById('diff-fallback').style.display = 'none';
    document.getElementById('diff-toggle').style.display = 'flex';
  };
  window.__drawDiff('side-by-side');
})();
</script>`
}

export function renderArtifactList(artifacts: Artifact[]): string {
  const rows = artifacts
    .map(
      a =>
        `<tr><td><a href="/artifacts/${escapeHtml(a.id)}">${escapeHtml(a.id)}</a></td>` +
        `<td>${escapeHtml(a.kind)}</td><td>${escapeHtml(a.title)}</td>` +
        `<td>${badge(a.status)}</td><td>${escapeHtml(a.summary ?? '')}</td></tr>`,
    )
    .join('\n')
  const table = artifacts.length
    ? `<table><tr><th>ID</th><th>Kind</th><th>Title</th><th>Status</th><th>Summary</th></tr>${rows}</table>`
    : '<p>No artifacts yet. Capture one with <code>ur artifacts capture-diff</code> or <code>ur artifacts add ...</code>.</p>'
  return page(
    'Artifacts',
    `<h1>Artifacts</h1><p><a class="btn" href="/diff">Current working-tree changes</a></p>${table}`,
  )
}

export function renderArtifactPage(artifact: Artifact, body: string | null): string {
  const feedback = artifact.feedback
    .map(f => `<div class="feedback"><span class="meta">${escapeHtml(f.at)}</span><br>${escapeHtml(f.text)}</div>`)
    .join('\n')
  const diffView = body !== null && isDiffArtifact(artifact)
  const parts = [
    `<p><a href="/">&larr; all artifacts</a></p>`,
    `<h1>Artifact ${escapeHtml(artifact.id)} <span class="meta">[${escapeHtml(artifact.kind)}]</span> ${badge(artifact.status)}</h1>`,
    `<p><strong>${escapeHtml(artifact.title)}</strong></p>`,
    artifact.summary ? `<p>${escapeHtml(artifact.summary)}</p>` : '',
    `<p class="meta">created ${escapeHtml(artifact.createdAt)} · updated ${escapeHtml(artifact.updatedAt)}${
      artifact.file ? ` · <a href="/artifacts/${escapeHtml(artifact.id)}/raw">raw</a>` : ''
    }</p>`,
    artifact.links?.claims?.length
      ? `<p class="meta">claims: ${artifact.links.claims.map(escapeHtml).join(', ')}</p>`
      : '',
    feedback ? `<h2>Feedback</h2>${feedback}` : '',
    body !== null
      ? `<h2>Content</h2>${diffView ? renderDiffBlock(body) : `<pre>${escapeHtml(body)}</pre>`}`
      : '',
  ]
  return page(
    `Artifact ${artifact.id} — ${artifact.title}`,
    parts.filter(Boolean).join('\n'),
    diffView ? DIFF_VIEWER_HEAD : '',
  )
}

export function renderLiveDiffPage(diff: string): string {
  const hasDiff = diff.trim().length > 0
  const content = hasDiff
    ? `${renderDiffBlock(diff)}
<script>
function __captureDiff() {
  fetch('/api/capture-diff', { method: 'POST' })
    .then(function (r) { return r.json() })
    .then(function (d) { if (d.id) location = '/artifacts/' + d.id; else alert(d.error || 'No changes to capture.') })
    .catch(function (e) { alert(String(e)) })
}
</script>`
    : '<p>No working-tree changes.</p>'
  const captureButton = hasDiff
    ? '<div class="toolbar"><button class="btn" onclick="__captureDiff()">Capture as artifact</button></div>'
    : ''
  return page(
    'Working tree changes',
    `<p><a href="/">&larr; all artifacts</a></p><h1>Working tree changes</h1>${captureButton}${content}`,
    hasDiff ? DIFF_VIEWER_HEAD : '',
  )
}

function notFound(id: string): string {
  return page('Artifact not found', `<h1>Artifact not found: ${escapeHtml(id)}</h1><p><a href="/">&larr; all artifacts</a></p>`)
}

type HttpPayload = { status: number; type: string; body: string }

export async function handleArtifactsRequest(
  cwd: string,
  url: string,
  exec?: CommandExec,
): Promise<HttpPayload> {
  const path = decodeURIComponent(new URL(url, 'http://localhost').pathname).replace(/\/+$/, '') || '/'
  if (path === '/' || path === '/artifacts') {
    return { status: 200, type: 'text/html', body: renderArtifactList(listArtifacts(cwd)) }
  }
  if (path === '/diff') {
    return { status: 200, type: 'text/html', body: renderLiveDiffPage(await getWorkingDiff(cwd, exec)) }
  }
  if (path === '/api/diff') {
    return { status: 200, type: 'text/plain', body: await getWorkingDiff(cwd, exec) }
  }
  if (path === '/api/artifacts') {
    return { status: 200, type: 'application/json', body: JSON.stringify({ artifacts: listArtifacts(cwd) }, null, 2) }
  }
  let match = path.match(/^\/api\/artifacts\/([^/]+)$/)
  if (match) {
    const artifact = getArtifact(cwd, match[1]!)
    return artifact
      ? { status: 200, type: 'application/json', body: JSON.stringify(artifact, null, 2) }
      : { status: 404, type: 'application/json', body: JSON.stringify({ error: `Artifact not found: ${match[1]}` }) }
  }
  match = path.match(/^\/artifacts\/([^/]+)\/raw$/)
  if (match) {
    const body = readArtifactBody(cwd, match[1]!)
    return body !== null
      ? { status: 200, type: 'text/plain', body }
      : { status: 404, type: 'text/plain', body: `Artifact body not found: ${match[1]}` }
  }
  match = path.match(/^\/(?:artifacts\/)?([^/]+)$/)
  if (match) {
    const artifact = getArtifact(cwd, match[1]!)
    if (artifact) {
      return { status: 200, type: 'text/html', body: renderArtifactPage(artifact, readArtifactBody(cwd, artifact.id)) }
    }
    return { status: 404, type: 'text/html', body: notFound(match[1]!) }
  }
  return { status: 404, type: 'text/html', body: notFound(path) }
}

export async function handleArtifactsPost(
  cwd: string,
  url: string,
  exec?: CommandExec,
): Promise<HttpPayload> {
  const path = new URL(url, 'http://localhost').pathname.replace(/\/+$/, '')
  if (path === '/api/capture-diff') {
    const artifact = await captureDiff(cwd, 'Working tree diff', exec)
    return artifact
      ? { status: 200, type: 'application/json', body: JSON.stringify({ id: artifact.id }) }
      : { status: 200, type: 'application/json', body: JSON.stringify({ error: 'No working-tree changes to capture.' }) }
  }
  return { status: 404, type: 'application/json', body: JSON.stringify({ error: `Unknown endpoint: ${path}` }) }
}

let active: { server: Server; port: number } | null = null

export function activeArtifactsServer(): { port: number; url: string } | null {
  return active ? { port: active.port, url: `http://127.0.0.1:${active.port}` } : null
}

export function startArtifactsServer(
  cwd: string,
  port = 4180,
  exec?: CommandExec,
): Promise<{ port: number; url: string; alreadyRunning: boolean }> {
  if (active) {
    return Promise.resolve({ port: active.port, url: `http://127.0.0.1:${active.port}`, alreadyRunning: true })
  }
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const respond = (r: HttpPayload) => {
        res.writeHead(r.status, { 'content-type': `${r.type}; charset=utf-8` })
        res.end(r.body)
      }
      const handler =
        req.method === 'GET'
          ? handleArtifactsRequest(cwd, req.url ?? '/', exec)
          : req.method === 'POST'
            ? handleArtifactsPost(cwd, req.url ?? '/', exec)
            : Promise.resolve<HttpPayload>({ status: 405, type: 'text/plain', body: 'Method not allowed' })
      handler.then(respond).catch(error => respond({ status: 500, type: 'text/plain', body: String(error) }))
    })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const boundPort = typeof address === 'object' && address ? address.port : port
      active = { server, port: boundPort }
      resolvePromise({ port: boundPort, url: `http://127.0.0.1:${boundPort}`, alreadyRunning: false })
    })
  })
}

export async function stopArtifactsServer(): Promise<boolean> {
  if (!active) return false
  const { server } = active
  active = null
  await new Promise<void>(resolvePromise => server.close(() => resolvePromise()))
  return true
}
