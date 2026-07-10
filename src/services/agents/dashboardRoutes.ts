import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'
import { getTaskListId, listTasks } from '../../utils/tasks.js'
import { listBackgroundTasks } from './backgroundRunner.js'
import { listCloudTasks } from './cloudTasks.js'
import { loadStats } from './learning.js'

/**
 * Live web dashboard + shared-thread routes, mounted on the artifacts
 * server (one local HTTP surface for everything reviewable):
 *   /dashboard        — cloud tasks, background agents, task board, learning
 *   /threads          — list of shared session threads
 *   /threads/<id>     — a thread exported by `ur thread share`
 * Read-only over local JSON state; no network, no tokens.
 */

type HttpPayload = { status: number; type: string; body: string }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#222}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left}
h1,h2{border-bottom:1px solid #eee;padding-bottom:4px}.ok{color:#2c7a39}.bad{color:#ab2b3f}
code{background:#f4f4f4;padding:1px 4px;border-radius:3px}a{color:#4f46e5}</style>
<body>${body}</body>`
}

export function threadsDir(cwd: string): string {
  return join(cwd, '.ur', 'threads')
}

function listThreads(cwd: string): string[] {
  const dir = threadsDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, ''))
}

export async function handleDashboardRequest(
  cwd: string,
  path: string,
): Promise<HttpPayload | null> {
  if (path === '/threads') {
    const threads = listThreads(cwd)
    return {
      status: 200,
      type: 'text/html',
      body: page(
        'Shared threads',
        `<h1>Shared threads</h1>${
          threads.length
            ? `<ul>${threads.map(t => `<li><a href="/threads/${esc(t)}">${esc(t)}</a></li>`).join('')}</ul>`
            : '<p>None yet — share one with <code>ur thread share</code>.</p>'
        }<p><a href="/dashboard">← dashboard</a></p>`,
      ),
    }
  }

  const threadMatch = path.match(/^\/threads\/([\w.-]+)$/)
  if (threadMatch) {
    const file = join(threadsDir(cwd), `${threadMatch[1]}.html`)
    return existsSync(file)
      ? { status: 200, type: 'text/html', body: readFileSync(file, 'utf-8') }
      : { status: 404, type: 'text/plain', body: `Thread not found: ${threadMatch[1]}` }
  }

  if (path !== '/dashboard' && path !== '/api/dashboard') return null

  const cloud = listCloudTasks(cwd)
  const bg = listBackgroundTasks(cwd)
  const tasks = await listTasks(getTaskListId()).catch(() => [])
  const stats = loadStats(cwd)

  if (path === '/api/dashboard') {
    return {
      status: 200,
      type: 'application/json',
      body: JSON.stringify({ cloud, background: bg, tasks, learning: stats }, null, 2),
    }
  }

  const cloudRows = cloud
    .slice(-15)
    .reverse()
    .map(
      t =>
        `<tr><td><code>${esc(t.id)}</code></td><td>${esc(t.status)}</td><td>best-of-${t.attempts}</td><td>${esc(t.task.slice(0, 70))}</td></tr>`,
    )
    .join('')
  const bgRows = bg
    .slice(-15)
    .reverse()
    .map(
      t =>
        `<tr><td><code>${esc(t.id)}</code></td><td>${esc(t.status)}</td><td>${esc(t.task.slice(0, 70))}</td></tr>`,
    )
    .join('')
  const taskRows = tasks
    .slice(0, 25)
    .map(
      t =>
        `<tr><td>${esc(t.id)}</td><td>${esc(t.status)}</td><td>${esc(t.subject.slice(0, 80))}</td></tr>`,
    )
    .join('')
  const cats = Object.entries(stats.categories)
    .map(([c, t]) => {
      const total = t.pass + t.fail
      return `<tr><td>${esc(c)}</td><td class="${t.pass / Math.max(1, total) >= 0.6 ? 'ok' : 'bad'}">${t.pass}/${total}</td></tr>`
    })
    .join('')

  const body = `<h1>UR dashboard</h1>
<p><a href="/artifacts">artifacts</a> · <a href="/diff">live diff</a> · <a href="/threads">shared threads</a> · <a href="/api/dashboard">json</a></p>
<h2>Cloud tasks (best-of-N)</h2><table><tr><th>id</th><th>status</th><th>mode</th><th>task</th></tr>${cloudRows || '<tr><td colspan=4>none</td></tr>'}</table>
<h2>Background agents</h2><table><tr><th>id</th><th>status</th><th>task</th></tr>${bgRows || '<tr><td colspan=3>none</td></tr>'}</table>
<h2>Task board</h2><table><tr><th>id</th><th>status</th><th>subject</th></tr>${taskRows || '<tr><td colspan=3>none</td></tr>'}</table>
<h2>Learning (pass/total by category)</h2><table><tr><th>category</th><th>rate</th></tr>${cats || '<tr><td colspan=2>no outcomes yet</td></tr>'}</table>`

  return { status: 200, type: 'text/html', body: page('UR dashboard', body) }
}
