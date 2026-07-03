// Extension-side manifest checks: the new chat commands are registered and
// the extension's version stays in lockstep with the root package (enforced
// separately by test/agentFeatureCommands.test.ts's VSIX packaging test —
// this is the same invariant checked from inside the extension's own tree).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const extensionManifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'))
const rootManifest = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', '..', 'package.json'), 'utf8'))

const CHAT_COMMANDS = [
  'urInlineDiffs.chat.new',
  'urInlineDiffs.chat.open',
  'urInlineDiffs.chat.cancel',
  'urInlineDiffs.chat.addFile',
  'urInlineDiffs.chat.addSelection',
  'urInlineDiffs.chat.explainSelection',
  'urInlineDiffs.chat.fixSelection',
  'urInlineDiffs.chat.generateTests',
]

const PR3_COMMANDS = [
  'urInlineDiffs.agentStatus',
  'urInlineDiffs.agentOptions',
  'urInlineDiffs.reviewCurrentDiff',
  'urInlineDiffs.runVerifier',
  'urInlineDiffs.searchActions',
  'urInlineDiffs.openSettings',
  'urInlineDiffs.openDocs',
  'urInlineDiffs.openArtifacts',
  'urInlineDiffs.runSpec',
  'urInlineDiffs.runWorkflow',
  'urActions.refresh',
  'urActions.openBackgroundLog',
]

describe('extension manifest', () => {
  test('keeps the existing extension id/name and Activity Bar container unchanged', () => {
    expect(extensionManifest.name).toBe('ur-inline-diffs')
    expect(extensionManifest.publisher).toBe('ur-agent')
    expect(extensionManifest.contributes.viewsContainers.activitybar[0].id).toBe('ur')
    expect(extensionManifest.contributes.views.ur[0].id).toBe('urInlineDiffs')
  })

  test('main still points at the bundled esbuild output', () => {
    expect(extensionManifest.main).toBe('./out/extension.js')
  })

  test('every new chat command is registered in contributes.commands', () => {
    const commandIds = extensionManifest.contributes.commands.map((command: { command: string }) => command.command)
    for (const id of CHAT_COMMANDS) {
      expect(commandIds).toContain(id)
    }
  })

  test('every new chat command has an activation event', () => {
    for (const id of CHAT_COMMANDS) {
      expect(extensionManifest.activationEvents).toContain(`onCommand:${id}`)
    }
  })

  test('existing inline diff commands remain registered (PR1 behavior preserved)', () => {
    const commandIds = extensionManifest.contributes.commands.map((command: { command: string }) => command.command)
    for (const id of ['urInlineDiffs.refresh', 'urInlineDiffs.open', 'urInlineDiffs.comment', 'urInlineDiffs.apply', 'urInlineDiffs.reject', 'urInlineDiffs.status']) {
      expect(commandIds).toContain(id)
    }
  })

  test('editor selection actions are wired into the editor context menu', () => {
    const editorContextCommands = extensionManifest.contributes.menus['editor/context'].map(
      (entry: { command: string }) => entry.command,
    )
    expect(editorContextCommands).toContain('urInlineDiffs.chat.explainSelection')
    expect(editorContextCommands).toContain('urInlineDiffs.chat.fixSelection')
    expect(editorContextCommands).toContain('urInlineDiffs.chat.generateTests')
  })

  test('extension version matches the root package version', () => {
    expect(extensionManifest.version).toBe(rootManifest.version)
  })

  test('the urActions view is registered alongside urInlineDiffs (additive, not a replacement)', () => {
    const viewIds = extensionManifest.contributes.views.ur.map((view: { id: string }) => view.id)
    expect(viewIds).toContain('urInlineDiffs')
    expect(viewIds).toContain('urActions')
  })

  test('every PR3 command is registered in contributes.commands with an activation event', () => {
    const commandIds = extensionManifest.contributes.commands.map((command: { command: string }) => command.command)
    for (const id of PR3_COMMANDS) {
      expect(commandIds).toContain(id)
      expect(extensionManifest.activationEvents).toContain(`onCommand:${id}`)
    }
  })

  test('every command declared in contributes.commands has a clean, non-empty title', () => {
    for (const command of extensionManifest.contributes.commands as Array<{ command: string; title: string }>) {
      expect(command.title.trim()).toBe(command.title)
      expect(command.title.length).toBeGreaterThan(0)
    }
  })

  test('command ids are unique across the whole manifest (no accidental duplicate registration)', () => {
    const commandIds = extensionManifest.contributes.commands.map((command: { command: string }) => command.command)
    expect(new Set(commandIds).size).toBe(commandIds.length)
  })

  test('diff bundle actions (open/apply/reject/comment) are wired into both the inline diff tree and the actions panel', () => {
    const diffItemMenus = extensionManifest.contributes.menus['view/item/context'] as Array<{ command: string; when: string }>
    for (const id of ['urInlineDiffs.open', 'urInlineDiffs.apply', 'urInlineDiffs.reject', 'urInlineDiffs.comment']) {
      const entry = diffItemMenus.find(m => m.command === id)
      expect(entry).toBeDefined()
      expect(entry?.when).toContain('urInlineDiffs')
      expect(entry?.when).toContain('urActions')
    }
  })

  test('the actions panel has its own refresh button in its view/title menu', () => {
    const titleMenus = extensionManifest.contributes.menus['view/title'] as Array<{ command: string; when: string }>
    const refreshEntry = titleMenus.find(m => m.command === 'urActions.refresh')
    expect(refreshEntry).toBeDefined()
    expect(refreshEntry?.when).toContain('urActions')
  })
})
