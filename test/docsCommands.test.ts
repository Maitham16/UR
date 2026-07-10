import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const REPO = join(import.meta.dir, '..')

function readRepoFile(path: string): string {
  return readFileSync(join(REPO, path), 'utf8')
}

function docFiles(): string[] {
  const files = ['README.md']
  for (const dir of ['docs', 'examples', 'technical']) {
    for (const entry of readdirSync(join(REPO, dir))) {
      if (entry.endsWith('.md')) files.push(`${dir}/${entry}`)
    }
  }
  return files
}

function staticSiteCommandNames(): string[] {
  const source = readRepoFile('documentation/app.js')
  const commandBlock = source.match(
    /const commands = \[([\s\S]*?)\n\];\n\nconst slashGroups/,
  )?.[1]
  if (!commandBlock) throw new Error('documentation/app.js command catalog not found')
  return [...commandBlock.matchAll(/\n\s+name: '([^']+)'/g)].map(
    match => match[1]!,
  )
}

/** Top-level CLI commands and aliases registered in both CLI entry layers. */
function registeredCommands(): Set<string> {
  const source = [
    readRepoFile('src/entrypoints/cli.tsx'),
    readRepoFile('src/main.tsx'),
  ].join('\n')
  const names = new Set<string>()
  for (const match of source.matchAll(/\.command\('([a-z][a-z0-9-]*)/g)) {
    names.add(match[1]!)
  }
  for (const match of source.matchAll(/\.alias\('([a-z][a-z0-9-]*)'\)/g)) {
    names.add(match[1]!)
  }
  // The fast entrypoint dispatches a few feature-gated commands before
  // Commander and therefore represents them as direct argv checks/cases.
  for (const match of source.matchAll(/args\[0\]\s*===\s*'([a-z][a-z0-9-]*)'/g)) {
    names.add(match[1]!)
  }
  for (const match of source.matchAll(/case '([a-z][a-z0-9-]*)':/g)) {
    names.add(match[1]!)
  }
  return names
}

/** `ur <subcommand>` tokens used inside fenced code blocks and inline code. */
function documentedCommands(doc: string): Set<string> {
  const found = new Set<string>()
  const codeChunks: string[] = []
  for (const match of doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    codeChunks.push(match[1]!)
  }
  for (const match of doc.matchAll(/`([^`\n]+)`/g)) {
    codeChunks.push(match[1]!)
  }
  for (const chunk of codeChunks) {
    for (const match of chunk.matchAll(/(?:^|[\s|;&(])ur\s+([a-z][a-z0-9-]*)/g)) {
      found.add(match[1]!)
    }
  }
  return found
}

describe('documentation commands and links', () => {
  const commands = registeredCommands()

  test('command extraction sees the real CLI surface', () => {
    for (const known of ['spec', 'provider', 'connect', 'ci-loop', 'eval', 'acp']) {
      expect(commands.has(known)).toBe(true)
    }
  })

  for (const file of docFiles()) {
    test(`every ur command documented in ${file} exists in the CLI`, () => {
      const documented = documentedCommands(readRepoFile(file))
      const unknown = [...documented].filter(name => !commands.has(name))
      expect(unknown).toEqual([])
    })
  }

  test('relative markdown links in README and docs resolve to files', () => {
    for (const file of [
      'README.md',
      ...docFiles().filter(
        file => file.startsWith('docs/') || file.startsWith('technical/'),
      ),
    ]) {
      const doc = readRepoFile(file)
      for (const match of doc.matchAll(/\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)) {
        const target = match[1]!
        if (/^[a-z]+:/i.test(target)) continue // external URL
        const base = dirname(join(REPO, file))
        const resolved = resolve(base, target)
        expect(
          existsSync(resolved),
          `${file} links to missing file: ${target}`,
        ).toBe(true)
      }
    }
  })

  test('static documentation site has one card for every shipped CLI command', () => {
    const names = staticSiteCommandNames()
    expect(names).toHaveLength(58) // `ur`, `ur -p`, and 56 shipped subcommands
    expect(new Set(names).size).toBe(names.length)

    const commandNames = names.filter(name => name !== 'ur' && name !== 'ur -p')
    expect(commandNames).toHaveLength(56)
    for (const name of commandNames) expect(commands.has(name)).toBe(true)
    for (const required of ['audit', 'cloud', 'recipe', 'thread', 'wiki']) {
      expect(commandNames).toContain(required)
    }
  })

  test('static documentation version and HTML ids are consistent', () => {
    const packageVersion = JSON.parse(readRepoFile('package.json')).version
    const html = readRepoFile('documentation/index.html')
    expect(html).toContain(`Version ${packageVersion}`)

    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]!)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('npm package files include the documentation set', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'))
    for (const entry of ['docs', 'documentation', 'examples', 'README.md', 'CHANGELOG.md']) {
      expect(packageJson.files).toContain(entry)
    }
  })
})
