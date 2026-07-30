import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { KNOWN_AGENTS } from '../src/services/agents/workflows.ts'
import { UR_CODE_GUIDE_AGENT_TYPE } from '../src/tools/AgentTool/built-in/urCodeGuideAgent.ts'

// The shipped, registered ur-guide agent instructed the model to fetch
// docs.claude.com and present it to users as "UR SDK docs" and "UR API docs",
// with a line reading "Agent SDK docs are part of the UR API documentation at
// the same URL". Answering questions about UR out of another product's manual
// is wrong however closely the two are related. Its other source, docs.ur.dev,
// was never served.

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, found)
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full)
  }
  return found
}

/** Line comments stripped: they legitimately cite upstream API docs. */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')
}

test('no user-facing string points at another product’s documentation', () => {
  // Source citations in comments are fine and are stripped above — what must
  // not survive is a docs.claude.com URL the user or the model is sent to.
  const offenders = sourceFiles('src')
    .filter(file => code(file).includes('docs.claude.com'))
    .map(file => `  ${file}`)
  expect(offenders.join('\n')).toBe('')
})

test('no code path still references the unserved docs domain', () => {
  const offenders = sourceFiles('src')
    .filter(file => code(file).includes('docs.ur.dev'))
    .map(file => `  ${file}`)
  expect(offenders.join('\n')).toBe('')
})

test('link text matches link target', () => {
  // Two sandbox dialogs pointed their href at the new domain while still
  // displaying the old one, which reads as a typo and undermines trust in
  // every other link.
  // Both sides normalised: a label may or may not carry the scheme, and the
  // href always does. Comparing them raw reported six correct links as broken
  // purely because the regex had stripped "https://" from one side only.
  const bare = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const offenders: string[] = []

  for (const file of sourceFiles('src')) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(
      /<Link url="(https:\/\/[^"]+)">([^<{]+)<\/Link>/g,
    )) {
      const target = bare(match[1]!)
      const text = bare(match[2]!.trim())
      if (!text.includes('.')) continue // not a URL-shaped label
      if (!target.startsWith(text)) {
        offenders.push(`  ${file}\n    shows ${text}\n    goes to ${target}`)
      }
    }
  }
  expect(offenders.join('\n')).toBe('')
})

test('the workflow agent allowlist names the agent that actually exists', () => {
  // KNOWN_AGENTS listed 'ur-code-guide'. The registered type is 'ur-guide', so
  // a workflow using the real agent was warned as unknown while the listed
  // name would have been accepted despite resolving to nothing.
  expect(KNOWN_AGENTS).toContain(UR_CODE_GUIDE_AGENT_TYPE)
  expect(KNOWN_AGENTS).not.toContain('ur-code-guide')
})
