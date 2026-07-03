// Extension-side manifest checks: the new chat commands are registered and
// the extension's version stays in lockstep with the root package (enforced
// separately by test/agentFeatureCommands.test.ts's VSIX packaging test —
// this is the same invariant checked from inside the extension's own tree).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const extensionManifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'))
const rootManifest = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', '..', 'package.json'), 'utf8'))
const extensionRoot = join(import.meta.dir, '..')
const activityBarIconPath = join(extensionRoot, extensionManifest.contributes.viewsContainers.activitybar[0].icon)

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
  'urInlineDiffs.pickModel',
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
    expect(extensionManifest.contributes.views.ur.map((view: { id: string }) => view.id)).toEqual([
      'urChat',
      'urInlineDiffs',
      'urActions',
    ])
  })

  test('Activity Bar icon points at a valid non-empty monochrome SVG', () => {
    const container = extensionManifest.contributes.viewsContainers.activitybar[0]
    expect(container.icon).toBe('media/ur.svg')
    expect(existsSync(activityBarIconPath)).toBe(true)
    const svg = readFileSync(activityBarIconPath, 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('viewBox=')
    expect(svg).toContain('<path')
    expect(svg).toContain('currentColor')
    expect(svg).not.toContain('<rect')
  })

  test('main still points at the bundled esbuild output', () => {
    expect(extensionManifest.main).toBe('./out/extension.js')
  })

  test('contributes configurable UR executable settings', () => {
    const properties = extensionManifest.contributes.configuration.properties
    expect(properties['ur.executablePath']).toBeDefined()
    expect(properties['ur.executablePath'].type).toBe('string')
    expect(properties['ur.executableArgs']).toBeDefined()
    expect(properties['ur.executableArgs'].type).toBe('array')
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

  test('command palette exposes the primary chat and search commands', () => {
    const titlesByCommand = Object.fromEntries(
      extensionManifest.contributes.commands.map((command: { command: string; title: string }) => [
        command.command,
        command.title,
      ]),
    )
    expect(titlesByCommand['urInlineDiffs.chat.new']).toBe('UR: New Chat')
    expect(titlesByCommand['urInlineDiffs.chat.open']).toBe('UR: Open Chat')
    expect(titlesByCommand['urInlineDiffs.searchActions']).toBe('UR: Search Actions')
    expect(titlesByCommand['urInlineDiffs.pickModel']).toBe('UR: Pick Model')
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

  test('the chat and actions views are registered alongside urInlineDiffs (additive, not a replacement)', () => {
    const viewIds = extensionManifest.contributes.views.ur.map((view: { id: string }) => view.id)
    expect(viewIds).toContain('urChat')
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

  test('the Chat view has title actions for New Chat, Open Chat, and Search Actions', () => {
    const titleMenus = extensionManifest.contributes.menus['view/title'] as Array<{ command: string; when: string }>
    const chatTitleCommands = titleMenus.filter(m => m.when === 'view == urChat').map(m => m.command)
    expect(chatTitleCommands).toContain('urInlineDiffs.chat.new')
    expect(chatTitleCommands).toContain('urInlineDiffs.chat.open')
    expect(chatTitleCommands).toContain('urInlineDiffs.searchActions')
  })

  test('sidebar welcome text is readable for Chat, Inline Diffs, and Actions', () => {
    const welcomeByView = Object.fromEntries(
      extensionManifest.contributes.viewsWelcome.map((entry: { view: string; contents: string }) => [
        entry.view,
        entry.contents,
      ]),
    )
    expect(welcomeByView.urChat).toContain('Start a UR chat')
    expect(welcomeByView.urInlineDiffs).toContain('Review diff bundles captured by `ur ide diff capture`')
    expect(welcomeByView.urActions).toContain('Background tasks and diff actions will appear here')
  })
})
