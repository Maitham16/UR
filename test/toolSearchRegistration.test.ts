import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ToolSearchTool } from '../src/tools/ToolSearchTool/ToolSearchTool.ts'
import { supportsToolReferenceExpansion } from '../src/utils/toolSearch.ts'

// ToolSearchTool existed to fetch schemas for tools whose definitions were
// deferred. Deferral requires the runtime to expand tool_reference blocks, and
// no UR runtime does — UR runs on Ollama, OpenAI-compatible servers and vendor
// CLIs. isEnabled() consulted only isToolSearchEnabledOptimistic(), which reads
// the mode, and the mode defaults to 'tst' (on). So the tool registered on
// every run: its description was sent with each request, and the model was
// offered a tool that could not work, since nothing was ever deferred for it
// to fetch.

test('no UR runtime expands tool_reference, so nothing is ever deferred', () => {
  expect(supportsToolReferenceExpansion()).toBe(false)
})

test('the tool is not registered when deferral cannot work', () => {
  // Directly the condition above: if deferral is impossible the tool has no
  // job, and its prompt is pure per-request overhead.
  expect(ToolSearchTool.isEnabled()).toBe(false)
})

test('registration checks runtime support, not just the mode', () => {
  // The mode alone is not sufficient — it defaults to on. Asserting the source
  // as well as the behaviour, because a future change to the default would
  // silently re-register the tool if only the mode were consulted.
  const source = readFileSync(
    'src/tools/ToolSearchTool/ToolSearchTool.ts',
    'utf8',
  )
  const at = source.indexOf('isEnabled()')
  expect(at).toBeGreaterThan(-1)
  expect(source.slice(at, at + 700)).toContain('supportsToolReferenceExpansion')
})
