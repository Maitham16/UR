/**
 * Local web page for artifacts: `ur artifacts serve` starts an HTTP server on
 * 127.0.0.1 that renders `.ur/artifacts/` — GET /artifacts/<id> shows one
 * artifact, / lists all, /diff shows live working-tree changes. Diff artifacts
 * render VS Code-style (side-by-side, syntax highlighted) via diff2html served
 * locally from /assets, with an escaped <pre> fallback if assets are missing.
 */

import { createReadStream, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { handleDashboardRequest } from './dashboardRoutes.js'
import { createRequire } from 'node:module'
import { escapeXmlAttr as escapeHtml } from '../../utils/xml.js'
import {
  captureDiff,
  getArtifact,
  getWorkingDiff,
  listArtifacts,
  openArtifactAttachment,
  readArtifactBody,
  safeArtifactMimeType,
  type Artifact,
  type CommandExec,
} from './artifacts.js'

const STATUS_COLOR: Record<Artifact['status'], string> = {
  pending: '#b58900',
  approved: '#2aa15f',
  rejected: '#d94f4f',
}

// Served locally from the installed diff2html/highlight.js packages — no CDN,
// so pages render instantly even offline (plain <pre> fallback if unresolved).
const DIFF_VIEWER_HEAD = `
<link rel="stylesheet" href="/assets/hljs.css">
<link rel="stylesheet" href="/assets/diff2html.css">`

const ASSET_SPECS: Record<string, { spec: string; type: string }> = {
  '/assets/hljs.css': { spec: 'highlight.js/styles/github.min.css', type: 'text/css' },
  '/assets/diff2html.css': { spec: 'diff2html/bundles/css/diff2html.min.css', type: 'text/css' },
  '/assets/diff2html-ui.js': { spec: 'diff2html/bundles/js/diff2html-ui.min.js', type: 'text/javascript' },
}

const assetCache = new Map<string, string | null>()
const SAFE_INLINE_ATTACHMENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/webm',
  'video/mp4',
])

function attachmentDelivery(mimeType: string): {
  type: string
  disposition: 'inline' | 'attachment'
} {
  const safe = safeArtifactMimeType(mimeType)
  return SAFE_INLINE_ATTACHMENT_TYPES.has(safe)
    ? { type: safe, disposition: 'inline' }
    : { type: 'application/octet-stream', disposition: 'attachment' }
}

function loadAsset(path: string): string | null {
  if (assetCache.has(path)) return assetCache.get(path) ?? null
  let content: string | null = null
  const entry = ASSET_SPECS[path]
  if (entry) {
    try {
      content = readFileSync(createRequire(import.meta.url).resolve(entry.spec), 'utf-8')
    } catch {
      content = null
    }
  }
  assetCache.set(path, content)
  return content
}

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
  .attachments { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: .8rem; }
  .attachment { border: 1px solid #8884; border-radius: 6px; padding: .7rem; overflow: hidden; }
  .attachment img, .attachment video { display: block; width: 100%; max-height: 520px; object-fit: contain; background: #111; }
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
<script src="/assets/diff2html-ui.js"></script>
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
  const attachments = (artifact.attachments ?? [])
    .map((attachment, index) => {
      const href = `/artifacts/${encodeURIComponent(artifact.id)}/attachments/${index}`
      const preview = attachment.mimeType.startsWith('image/')
        ? `<a href="${href}"><img loading="lazy" src="${href}" alt="${escapeHtml(attachment.role)}"></a>`
        : attachment.mimeType.startsWith('video/')
          ? `<video controls preload="metadata" src="${href}"></video>`
          : ''
      return `<div class="attachment">${preview}<p><a href="${href}">${escapeHtml(attachment.role)}</a></p><p class="meta">${escapeHtml(attachment.mimeType)} · ${attachment.sizeBytes} bytes · sha256 ${escapeHtml(attachment.sha256.slice(0, 12))}…</p></div>`
    })
    .join('\n')
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
    attachments ? `<h2>Attachments</h2><div class="attachments">${attachments}</div>` : '',
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

type HttpPayload = {
  status: number
  type: string
  body: string
  file?: { cwd: string; path: string }
  headers?: Record<string, string>
}

export async function handleArtifactsRequest(
  cwd: string,
  url: string,
  exec?: CommandExec,
): Promise<HttpPayload> {
  const path = decodeURIComponent(new URL(url, 'http://localhost').pathname).replace(/\/+$/, '') || '/'
  // Dashboard + shared-thread routes live on the same local server so one
  // port serves everything reviewable. Checked before the /:id catch-all.
  const dashboard = await handleDashboardRequest(cwd, path)
  if (dashboard) return dashboard
  if (path.startsWith('/assets/')) {
    const entry = ASSET_SPECS[path]
    const content = loadAsset(path)
    return content !== null && entry
      ? { status: 200, type: entry.type, body: content }
      : { status: 404, type: 'text/plain', body: `Asset not found: ${path}` }
  }
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
    const artifact = getArtifact(cwd, match[1]!)
    return artifact?.file
      ? {
          status: 200,
          type: 'text/plain',
          body: '',
          file: { cwd, path: artifact.file },
          headers: {
            'cache-control': 'private, no-store',
            'content-disposition': `attachment; filename="${encodeURIComponent(artifact.file.split('/').at(-1) ?? 'artifact')}"`,
            'content-security-policy': "default-src 'none'; sandbox",
          },
        }
      : { status: 404, type: 'text/plain', body: `Artifact body not found: ${match[1]}` }
  }
  match = path.match(/^\/artifacts\/([^/]+)\/attachments\/(\d+)$/)
  if (match) {
    const artifact = getArtifact(cwd, match[1]!)
    const attachment = artifact?.attachments?.[Number(match[2])]
    if (attachment) {
      const delivery = attachmentDelivery(attachment.mimeType)
      return {
          status: 200,
          type: delivery.type,
          body: '',
          file: { cwd, path: attachment.path },
          headers: {
            'cache-control': 'private, no-store',
            'content-disposition': `${delivery.disposition}; filename="${encodeURIComponent(attachment.path.split('/').at(-1) ?? 'attachment')}"`,
            'content-security-policy': "default-src 'none'; sandbox",
          },
        }
    }
    return { status: 404, type: 'text/plain', body: 'Artifact attachment not found' }
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
type ArtifactsServerStart = { port: number; url: string; alreadyRunning: boolean }
let starting: Promise<ArtifactsServerStart> | null = null

export function activeArtifactsServer(): { port: number; url: string } | null {
  return active ? { port: active.port, url: `http://127.0.0.1:${active.port}` } : null
}

export function startArtifactsServer(
  cwd: string,
  port = 4180,
  exec?: CommandExec,
): Promise<ArtifactsServerStart> {
  if (active) {
    return Promise.resolve({ port: active.port, url: `http://127.0.0.1:${active.port}`, alreadyRunning: true })
  }
  if (starting) {
    return starting.then(result => ({ ...result, alreadyRunning: true }))
  }

  const operation = new Promise<ArtifactsServerStart>((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const respond = (r: HttpPayload) => {
        const textual =
          r.type.startsWith('text/') ||
          r.type === 'application/json' ||
          r.type === 'application/javascript'
        const opened = r.file
          ? openArtifactAttachment(r.file.cwd, r.file.path)
          : null
        if (r.file && !opened) {
          res.writeHead(404, {
            'content-type': 'text/plain; charset=utf-8',
            'x-content-type-options': 'nosniff',
          })
          res.end('Artifact attachment not found')
          return
        }
        res.writeHead(r.status, {
          'content-type': textual ? `${r.type}; charset=utf-8` : r.type,
          'x-content-type-options': 'nosniff',
          ...(r.type === 'text/html'
            ? {
                'content-security-policy':
                  "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
              }
            : {}),
          ...r.headers,
        })
        if (r.file && opened) {
          const stream = createReadStream(opened.path, {
            fd: opened.fd,
            autoClose: true,
          })
          stream.once('error', () => res.destroy())
          stream.pipe(res)
        } else {
          res.end(r.body)
        }
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
      server.once('close', () => {
        if (active?.server === server) active = null
      })
      resolvePromise({
        port: boundPort,
        url: `http://127.0.0.1:${boundPort}`,
        alreadyRunning: false,
      })
    })
  })
  starting = operation
  return operation.then(
    result => {
      if (starting === operation) starting = null
      return result
    },
    error => {
      if (starting === operation) starting = null
      throw error
    },
  )
}

export async function stopArtifactsServer(): Promise<boolean> {
  if (starting) await starting.catch(() => undefined)
  if (!active) return false
  const { server } = active
  active = null
  await new Promise<void>(resolvePromise => server.close(() => resolvePromise()))
  return true
}
