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
})
