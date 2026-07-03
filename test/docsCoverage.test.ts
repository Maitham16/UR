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
    for (const primitive of ['Agent', 'Rules', 'MCP', 'Skills', 'CLI', 'Models']) {
      expect(features).toContain(`| ${primitive} |`)
      expect(readme).toContain(primitive)
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
    expect(site).toMatch(/update \d+\.\d+\.\d+ available/)
    expect(readme).toContain('Development build detected. To update, pull latest source or install from npm.')
    expect(features).toContain('AskUserQuestion')
    expect(features).toContain('up to eight concrete options')
    expect(usage).toContain('does not rely on')
    expect(usage).toContain('the stale marketplace extension ID')
    expect(readme).toContain('packaged as a local VSIX')
  })

  test('IDE docs describe the professional integration, not just inline diffs, and never claim JetBrains is implemented', () => {
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

    // JetBrains must never be claimed as implemented in this repo.
    expect(ide).toContain('JetBrains is not implemented')
    expect(readme).toContain('JetBrains is not implemented')
    expect(ide).not.toContain('Install the UR JetBrains plugin')

    // Agent Options must stay explicitly non-authoritative.
    expect(ide).toContain('not live market research')
    expect(extensionReadme).toContain('not live market research')

    // No lingering claim that the diff-apply path writes a fake 'applied' status.
    expect(ide).not.toContain("status: 'applied'")
  })
})
