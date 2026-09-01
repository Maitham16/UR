import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import {
  builtInCommandNames,
  clearCommandsCache,
  getCommands,
  INTERNAL_ONLY_COMMANDS,
  normalizeCommandTokens,
} from '../src/commands.js'
import { initBundledSkills } from '../src/skills/bundled/index.js'
import { clearBundledSkills } from '../src/skills/bundledSkills.js'
import type { Command } from '../src/types/command.js'

type DocumentedOptionalImplementation = {
  path: string
  tokens: readonly string[]
}

const OPTIONAL_IMPLEMENTATIONS: readonly DocumentedOptionalImplementation[] = [
  {
    path: 'src/commands/proactive.ts',
    tokens: ['proactive'],
  },
  {
    path: 'src/commands/brief.ts',
    tokens: ['brief'],
  },
  {
    path: 'src/commands/assistant/index.ts',
    tokens: ['assistant'],
  },
  {
    path: 'src/commands/bridge/index.ts',
    tokens: ['remote-control', 'rc'],
  },
  {
    path: 'src/commands/voice/index.ts',
    tokens: ['voice'],
  },
  {
    path: 'src/commands/remote-setup/index.ts',
    tokens: ['web-setup'],
  },
  {
    path: 'src/skills/bundled/loop.ts',
    tokens: ['loop'],
  },
  {
    path: 'src/skills/bundled/scheduleRemoteAgents.ts',
    tokens: ['schedule'],
  },
  {
    path: 'src/skills/bundled/urApi.ts',
    tokens: ['ur-api'],
  },
  {
    path: 'src/skills/bundled/urInChrome.ts',
    tokens: ['ur-in-chrome'],
  },
  {
    path: 'src/skills/bundled/skillify.ts',
    tokens: ['skillify'],
  },
  {
    path: 'src/skills/bundled/remember.ts',
    tokens: ['remember'],
  },
  {
    path: 'src/skills/bundled/verify.ts',
    tokens: ['verify'],
  },
  {
    path: 'src/skills/bundled/loremIpsum.ts',
    tokens: ['lorem-ipsum'],
  },
  {
    path: 'src/skills/bundled/stuck.ts',
    tokens: ['stuck'],
  },
  {
    path: 'src/skills/bundled/keybindings.ts',
    tokens: ['keybindings-help'],
  },
  {
    path: 'src/skills/bundled/dream.ts',
    tokens: ['dream'],
  },
] as const

function addCommandTokens(target: Set<string>, command: Command): void {
  target.add(command.name)
  target.add(command.userFacingName?.() ?? command.name)
  for (const alias of command.aliases ?? []) target.add(alias)
}

function documentedSlashTokens(reference: string): Set<string> {
  return new Set(
    [...reference.matchAll(/`\/([a-z][a-z0-9-]*)/gu)].map(
      match => match[1]!,
    ),
  )
}

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
      // User-installed marketplace plugins are intentionally namespaced with
      // colons and vary by machine. Their manifests have separate validation;
      // this registry invariant covers the deterministic shipped core.
      const commands = (await getCommands(process.cwd())).filter(
        command =>
          command.type !== 'prompt' ||
          (command.source !== 'plugin' && command.source !== 'mcp'),
      )
      expect(commands.length).toBeGreaterThan(100)

      const owners = new Map<string, string>()
      for (const command of commands) {
        expect(command.description.trim()).not.toBe('')
        if (!command.isHidden) {
          expect(command.name).not.toMatch(/(?:^|-)v\d+(?:-|$)/iu)
          expect(command.description).not.toMatch(
            /\b(?:v1|v2|mcp2026|deprecated)\b/iu,
          )
        }

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
      const documentedTokens = documentedSlashTokens(reference)
      const shippedCommands = commands.filter(
        command =>
          (command.loadedFrom === undefined || command.loadedFrom === 'bundled'),
      )
      const undocumentedShippedTokens = new Set<string>()
      for (const command of shippedCommands.filter(command => !command.isHidden)) {
        const tokens = [
          command.name,
          command.userFacingName?.() ?? command.name,
          ...(command.aliases ?? []),
        ]
        for (const token of tokens) {
          if (!documentedTokens.has(token)) undocumentedShippedTokens.add(token)
        }
      }
      expect([...undocumentedShippedTokens].sort()).toEqual([])

      const implementedTokens = new Set<string>()
      for (const token of builtInCommandNames()) implementedTokens.add(token)
      for (const command of [...shippedCommands, ...INTERNAL_ONLY_COMMANDS]) {
        addCommandTokens(implementedTokens, command)
      }
      for (const implementation of OPTIONAL_IMPLEMENTATIONS) {
        expect(existsSync(implementation.path)).toBe(true)
        const source = readFileSync(implementation.path, 'utf8')
        for (const token of implementation.tokens) {
          expect(source).toContain(`'${token}'`)
          implementedTokens.add(token)
          expect(documentedTokens.has(token)).toBe(true)
        }
      }

      const unsupportedClaims = [...documentedTokens]
        .filter(token => !implementedTokens.has(token))
        .sort()
      expect(unsupportedClaims).toEqual([])
    } finally {
      clearCommandsCache()
      clearBundledSkills()
      if (previousToken === undefined) delete process.env.UR_CODE_OAUTH_TOKEN
      else process.env.UR_CODE_OAUTH_TOKEN = previousToken
    }
  })
})
