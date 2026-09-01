import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('documentation coverage', () => {
  test('documents core Cursor-style agent primitives', () => {
    const features = readFileSync(
      join(process.cwd(), 'docs', 'AGENT_FEATURES.md'),
      'utf8',
    )
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8')

    expect(features).toContain('## Core Agent Primitives')
    for (const [tableLabel, readmeLabel] of [
      ['Agent', 'Agent'],
      ['Rules', 'Rules'],
      ['Model Context Protocol', 'Model Context Protocol'],
      ['Skills', 'Skills'],
      ['CLI', 'CLI'],
      ['Models', 'Models'],
    ]) {
      expect(features).toContain(`| ${tableLabel} |`)
      expect(readme).toContain(readmeLabel)
    }
    expect(features).toContain('.cursor/rules/*.mdc')
    expect(features).toContain('.mcp.json')
    expect(features).toContain('ur model-doctor')
  })

  test('documents K-P reliability architecture commitments', () => {
    const features = readFileSync(
      join(process.cwd(), 'docs', 'AGENT_FEATURES.md'),
      'utf8',
    )
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8')

    expect(readme.replace(/\s+/g, ' ')).toContain('reproducible autonomous software engineering')
    expect(features).toContain('spec -> plan -> patch -> test -> report -> rollback')
    expect(features).toContain('compile proof, test proof, lint proof')
    for (const role of ['planner', 'executor', 'verifier', 'critic', 'memory manager', 'tool router', 'permission guard']) {
      expect(features).toContain(role)
    }
    for (const subagent of ['Bug finder', 'patch writer', 'test writer', 'security auditor', 'style reviewer']) {
      expect(features).toContain(subagent)
    }
  })

  test('documents AST-aware editing and built-in LSP support', () => {
    const features = readFileSync(
      join(process.cwd(), 'docs', 'AGENT_FEATURES.md'),
      'utf8',
    )

    expect(features).toContain('AST-aware editing')
    expect(features).toContain('symbol rename')
    expect(features).toContain('function/class move')
    expect(features).toContain('unused-code detection')
    expect(features).toContain('caller mapping')
    for (const server of [
      'typescript-language-server',
      'pyright-langserver',
      'rust-analyzer',
      'gopls',
    ]) {
      expect(features).toContain(server)
    }
  })

  test('technical integrations cover every shipped inbound event receiver', () => {
    const integrations = readFileSync(
      join(process.cwd(), 'technical', '11-integrations.md'),
      'utf8',
    )

    for (const producer of [
      'GitHub webhooks',
      'Slack events',
      'Gmail Pub/Sub',
      'Microsoft Teams/Graph',
      'generic JSON',
    ]) {
      expect(integrations).toContain(producer)
    }
    expect(integrations).toContain('durable session')
    expect(integrations).toContain('docs/TRIGGERS.md')
  })

  test('documents current provider, status bar, update, and IDE behavior', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8')
    const usage = readFileSync(join(process.cwd(), 'docs', 'USAGE.md'), 'utf8')
    const providers = readFileSync(
      join(process.cwd(), 'docs', 'providers.md'),
      'utf8',
    )
    const features = readFileSync(
      join(process.cwd(), 'docs', 'AGENT_FEATURES.md'),
      'utf8',
    )
    const site = readFileSync(
      join(process.cwd(), 'documentation', 'index.html'),
      'utf8',
    )

    for (const doc of [readme, usage, providers, features, site]) {
      expect(doc).toContain('ur provider')
      expect(doc).toContain('ur auth chatgpt')
      expect(doc).toContain('OpenAI-compatible')
    }

    expect(readme).toContain('ur config set provider openai-api')
    expect(readme).toContain('does not invent subscription models')
    expect(readme).toContain('external app bridge')
    expect(providers).toContain('ur provider doctor agy')
    expect(providers).toContain('`antigravity-cli` | `antigravity`, `agy`')
    expect(readme).toContain('Ollama | llama3 | ask | main')
    expect(usage).toContain('Ollama | llama3 | ask | main')
    const packageVersion = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ).version as string
    expect(site).toContain(`Version ${packageVersion}`)
    expect(site).toContain('update available')
    expect(readme).toContain('Development build detected. To update, pull latest source or install from npm.')
    expect(features).toContain('AskUserQuestion')
    expect(features).toContain('up to eight concrete options')
    expect(usage).toContain('does not rely on')
    expect(usage).toContain('the stale marketplace extension ID')
    expect(readme).toContain('packaged as a local VSIX')
  })

  test('keeps public and technical reasoning-effort contracts synchronized', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8')
    const providers = readFileSync(
      join(process.cwd(), 'docs', 'providers.md'),
      'utf8',
    )
    const cli = readFileSync(
      join(process.cwd(), 'technical', '02-cli-reference.md'),
      'utf8',
    )
    const slash = readFileSync(
      join(process.cwd(), 'technical', '03-slash-commands.md'),
      'utf8',
    )
    const models = readFileSync(
      join(process.cwd(), 'technical', '05-providers-and-models.md'),
      'utf8',
    )
    const configuration = readFileSync(
      join(process.cwd(), 'technical', '06-configuration.md'),
      'utf8',
    )
    const site = readFileSync(
      join(process.cwd(), 'documentation', 'index.html'),
      'utf8',
    )
    const siteCatalog = readFileSync(
      join(process.cwd(), 'documentation', 'app.js'),
      'utf8',
    )

    for (const doc of [providers, cli, slash, models, site]) {
      for (const level of [
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
        'ultra',
      ]) {
        expect(doc.toLowerCase()).toContain(level)
      }
    }
    for (const doc of [readme, providers, models, configuration, site]) {
      expect(doc).toContain('ultra→max')
      expect(doc.toLowerCase()).toContain('advertis')
    }
    expect(cli).toContain('`--effort <level>`')
    expect(slash).toContain(
      '`/effort [minimal\\|low\\|medium\\|high\\|xhigh\\|max\\|ultra\\|auto]`',
    )
    expect(models).toContain('provider-scoped `provider.baseUrls`')
    expect(models).toContain('Unsloth is an inference provider only')
    expect(models).toContain('five-minute cache')
    expect(configuration).toContain(
      '`ur config set base_url <provider> <url>`',
    )
    expect(configuration).toContain('`/effort auto` clears')
    expect(configuration).toContain('CLI flag values')
    expect(siteCatalog).toContain("'/effort ultra'")
    expect(slash).not.toContain('low\\|medium\\|high\\|max\\|auto]')
    expect(models).not.toContain('low·medium·high·max·auto')
  })

  test('IDE docs describe the professional integration and the bounded JetBrains implementation', () => {
    const ide = readFileSync(join(process.cwd(), 'docs', 'IDE.md'), 'utf8')
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8')
    const extensionReadme = readFileSync(
      join(process.cwd(), 'extensions', 'vscode-ur-inline-diffs', 'README.md'),
      'utf8',
    )

    // The extension is chat + diffs + actions + status + search + options —
    // guard against the docs regressing to the old inline-diff-only framing.
    for (const feature of ['chat panel', 'Actions panel', 'Agent Status', 'Agent Options', 'Search Actions']) {
      expect(ide).toContain(feature)
    }
    expect(ide).toContain('control_request')
    expect(ide).toContain('.ur/ide/chat/')
    expect(ide).toContain('stream-json')

    // The bundled JetBrains client is real but remains explicitly experimental
    // and non-streaming until a streaming ACP transport is implemented.
    expect(ide).toContain('JetBrains integration is experimental and non-streaming')
    expect(ide).toContain('session/prompt')
    expect(readme).toContain('experimental bundled JetBrains plugin')
    expect(ide).not.toContain('marketplace publishing is available')

    // Agent Options must stay explicitly non-authoritative.
    expect(ide).toContain('not live market research')
    expect(extensionReadme).toContain('not live market research')

    // No lingering claim that the diff-apply path writes a fake 'applied' status.
    expect(ide).not.toContain("status: 'applied'")
  })
})
