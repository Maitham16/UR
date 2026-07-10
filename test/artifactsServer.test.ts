import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addFeedback,
  recordArtifact,
  setStatus,
  type CommandExec,
} from '../src/services/agents/artifacts.ts'
import {
  activeArtifactsServer,
  handleArtifactsPost,
  handleArtifactsRequest,
  startArtifactsServer,
  stopArtifactsServer,
} from '../src/services/agents/artifactsServer.ts'

afterEach(async () => {
  await stopArtifactsServer()
})

const SAMPLE_DIFF = `diff --git a/sample.js b/sample.js
index 0000001..0ddf2ba 100644
--- a/sample.js
+++ b/sample.js
@@ -1 +1 @@
-console.log("old")
+console.log("new")
`

const diffExec: CommandExec = async () => ({ code: 0, stdout: SAMPLE_DIFF, stderr: '' })
const emptyExec: CommandExec = async () => ({ code: 0, stdout: '', stderr: '' })

function seed(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-serve-'))
  recordArtifact(tmp, { kind: 'plan', title: 'My <Plan>', body: '# Plan\nstep 1 & 2', summary: '2 steps' })
  setStatus(tmp, '1', 'approved')
  addFeedback(tmp, '1', 'nice & clean')
  return tmp
}

test('handleArtifactsRequest renders list, detail, raw, json, and 404', async () => {
  const tmp = seed()
  try {
    const list = await handleArtifactsRequest(tmp, '/')
    expect(list.status).toBe(200)
    expect(list.body).toContain('My &lt;Plan&gt;')
    expect(list.body).toContain('/artifacts/1')

    const detail = await handleArtifactsRequest(tmp, '/artifacts/1')
    expect(detail.status).toBe(200)
    expect(detail.type).toBe('text/html')
    expect(detail.body).toContain('Artifact 1')
    expect(detail.body).toContain('step 1 &amp; 2')
    expect(detail.body).toContain('nice &amp; clean')
    expect(detail.body).toContain('approved')

    const raw = await handleArtifactsRequest(tmp, '/artifacts/1/raw')
    expect(raw.status).toBe(200)
    expect(raw.body).toContain('step 1 & 2')

    const json = await handleArtifactsRequest(tmp, '/api/artifacts/1')
    expect(json.status).toBe(200)
    expect(JSON.parse(json.body).id).toBe('1')

    const all = await handleArtifactsRequest(tmp, '/api/artifacts')
    expect(JSON.parse(all.body).artifacts.length).toBe(1)

    expect((await handleArtifactsRequest(tmp, '/artifacts/99')).status).toBe(404)
    expect((await handleArtifactsRequest(tmp, '/api/artifacts/99')).status).toBe(404)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('short /<id> path serves the artifact page', async () => {
  const tmp = seed()
  try {
    const detail = await handleArtifactsRequest(tmp, '/1')
    expect(detail.status).toBe(200)
    expect(detail.body).toContain('Artifact 1')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('diff artifacts render the diff2html viewer with pre fallback', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-diffview-'))
  try {
    recordArtifact(tmp, { kind: 'diff', title: 'A diff', body: SAMPLE_DIFF })
    const detail = await handleArtifactsRequest(tmp, '/artifacts/1')
    expect(detail.body).toContain('/assets/diff2html-ui.js')
    expect(detail.body).toContain('Diff2HtmlUI')
    expect(detail.body).toContain('diff-fallback')
    expect(detail.body).toContain('side-by-side')
    // Diff payload is JSON-encoded for the inline script, with < escaped.
    expect(detail.body).not.toContain('</script>console')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('viewer assets are served locally', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-assets-'))
  try {
    const js = await handleArtifactsRequest(tmp, '/assets/diff2html-ui.js')
    expect(js.status).toBe(200)
    expect(js.type).toBe('text/javascript')
    expect(js.body.length).toBeGreaterThan(1000)
    const css = await handleArtifactsRequest(tmp, '/assets/diff2html.css')
    expect(css.status).toBe(200)
    expect(css.type).toBe('text/css')
    const hljs = await handleArtifactsRequest(tmp, '/assets/hljs.css')
    expect(hljs.status).toBe(200)
    expect((await handleArtifactsRequest(tmp, '/assets/nope.js')).status).toBe(404)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('non-diff artifacts do not load the diff viewer', async () => {
  const tmp = seed()
  try {
    const detail = await handleArtifactsRequest(tmp, '/artifacts/1')
    expect(detail.body).not.toContain('diff2html')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('live /diff page shows working-tree changes and capture button', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-live-'))
  try {
    const live = await handleArtifactsRequest(tmp, '/diff', diffExec)
    expect(live.status).toBe(200)
    expect(live.body).toContain('Working tree changes')
    expect(live.body).toContain('Capture as artifact')
    expect(live.body).toContain('/assets/diff2html-ui.js')

    const clean = await handleArtifactsRequest(tmp, '/diff', emptyExec)
    expect(clean.body).toContain('No working-tree changes')
    expect(clean.body).not.toContain('diff2html')

    const rawDiff = await handleArtifactsRequest(tmp, '/api/diff', diffExec)
    expect(rawDiff.body).toBe(SAMPLE_DIFF)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('POST /api/capture-diff records a diff artifact', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-capture-'))
  try {
    const captured = await handleArtifactsPost(tmp, '/api/capture-diff', diffExec)
    expect(JSON.parse(captured.body).id).toBe('1')
    const detail = await handleArtifactsRequest(tmp, '/artifacts/1')
    expect(detail.body).toContain('Diff2HtmlUI')

    const empty = await handleArtifactsPost(tmp, '/api/capture-diff', emptyExec)
    expect(JSON.parse(empty.body).error).toContain('No working-tree changes')

    expect((await handleArtifactsPost(tmp, '/api/nope')).status).toBe(404)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('startArtifactsServer serves GET and POST over HTTP and stops cleanly', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-http-'))
  try {
    const [first, concurrent] = await Promise.all([
      startArtifactsServer(tmp, 0, diffExec),
      startArtifactsServer(tmp, 0, diffExec),
    ])
    const { url, alreadyRunning } = first
    expect(alreadyRunning).toBe(false)
    expect(concurrent.alreadyRunning).toBe(true)
    expect(concurrent.url).toBe(url)
    expect(activeArtifactsServer()?.url).toBe(url)

    const live = await fetch(`${url}/diff`)
    expect(live.status).toBe(200)
    expect(await live.text()).toContain('Capture as artifact')

    const captured = await fetch(`${url}/api/capture-diff`, { method: 'POST' })
    expect((await captured.json()).id).toBe('1')

    const detail = await fetch(`${url}/artifacts/1`)
    expect(detail.status).toBe(200)
    expect(await detail.text()).toContain('Artifact 1')

    expect((await fetch(`${url}/artifacts/99`)).status).toBe(404)

    const second = await startArtifactsServer(tmp, 0)
    expect(second.alreadyRunning).toBe(true)
    expect(second.url).toBe(url)

    expect(await stopArtifactsServer()).toBe(true)
    expect(activeArtifactsServer()).toBeNull()
    expect(await stopArtifactsServer()).toBe(false)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
