import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import {
  clearCommandsCache,
  getCommands,
  normalizeCommandTokens,
} from '../src/commands.js'
import { initBundledSkills } from '../src/skills/bundled/index.js'
import { clearBundledSkills } from '../src/skills/bundledSkills.js'
import type { Command } from '../src/types/command.js'

function localCommand(name: string, aliases: string[] = []): Command {
  return {
    type: 'local',
    name,
    aliases,
    description: `${name} test command`,
    supportsNonInteractive: true,
    load: async () => ({
      call: async () => ({ type: 'text', value: name }),
    }),
  }
}

describe('command registry integrity', () => {
  test('normalization preserves source priority and removes ambiguous tokens', () => {
    const first = localCommand('first', ['shared', 'one'])
    const duplicateAlias = localCommand('second', ['shared', 'two', 'two'])
    const shadowed = localCommand('shared')

    const normalized = normalizeCommandTokens([
      first,
      duplicateAlias,
      shadowed,
    ])

    expect(normalized.map(command => command.name)).toEqual(['first', 'second'])
    expect(normalized[0]).toBe(first)
    expect(normalized[1]?.aliases).toEqual(['two'])
  })

  test('all shipped slash tokens are unique, valid, described, and loadable', async () => {
    const previousToken = process.env.UR_CODE_OAUTH_TOKEN
    process.env.UR_CODE_OAUTH_TOKEN = 'test-token'
    clearBundledSkills()
    initBundledSkills()
    clearCommandsCache()

    try {
      const commands = await getCommands(process.cwd())
      expect(commands.length).toBeGreaterThan(100)

      const owners = new Map<string, string>()
      for (const command of commands) {
        expect(command.description.trim()).not.toBe('')

        const tokens = [
          command.name,
          command.userFacingName?.() ?? command.name,
          ...(command.aliases ?? []),
        ]
        expect(new Set(command.aliases ?? []).size).toBe(
          command.aliases?.length ?? 0,
        )

        for (const token of new Set(tokens)) {
          expect(token).toMatch(/^[a-z][a-z0-9-]*$/)
          expect(owners.get(token)).toBeUndefined()
          owners.set(token, command.name)
        }

        if (command.type !== 'prompt') {
          const module = await command.load()
          expect(typeof module.call).toBe('function')
        }
      }

      const sandboxCommands = commands.filter(command => command.name === 'sandbox')
      expect(sandboxCommands).toHaveLength(1)
      const sandboxCommand = sandboxCommands[0]!
      expect(sandboxCommand.type).toBe('local-jsx')
      if (sandboxCommand.type !== 'local-jsx') {
        throw new Error('/sandbox must be the merged interactive command')
      }
      const sandboxModule = await sandboxCommand.load()
      let sandboxStatus = ''
      const rendered = await sandboxModule.call(
        value => {
          sandboxStatus = value ?? ''
        },
        {} as never,
        'status --json',
      )
      expect(rendered).toBeNull()
      expect(JSON.parse(sandboxStatus)).toHaveProperty('supported')

      expect(owners.get('paper')).toBe('paper')
      expect(owners.get('security')).toBe('security')
      expect(owners.get('audit')).toBe('audit')
      expect(owners.get('skills')).toBe('skills')
      expect(owners.get('security-review')).toBe('security-review')

      const reference = readFileSync(
        'technical/03-slash-commands.md',
        'utf8',
      )
      const shippedVisibleCommands = commands.filter(
        command =>
          !command.isHidden &&
          (command.loadedFrom === undefined || command.loadedFrom === 'bundled'),
      )
      for (const command of shippedVisibleCommands) {
        const name = command.userFacingName?.() ?? command.name
        expect(reference).toContain(`/${name}`)
      }
    } finally {
      clearCommandsCache()
      clearBundledSkills()
      if (previousToken === undefined) delete process.env.UR_CODE_OAUTH_TOKEN
      else process.env.UR_CODE_OAUTH_TOKEN = previousToken
    }
  })
})
