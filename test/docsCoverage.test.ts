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

    expect(readme).toContain('ur config set provider claude')
    expect(providers).toContain('ur provider doctor agy')
    expect(providers).toContain('`antigravity-cli` | `antigravity`, `agy`')
    expect(readme).toContain('UR-AGENT v1.30.3')
    expect(usage).toContain('UR-AGENT v1.30.3')
    expect(site).toContain('Version 1.30.3')
    expect(site).toContain('Update: 1.30.2 -&gt; 1.30.3 available')
    expect(readme).toContain('Development build detected. To update, pull latest source or install from npm.')
    expect(features).toContain('AskUserQuestion')
    expect(features).toContain('up to eight concrete options')
    expect(usage).toContain('does not rely on')
    expect(usage).toContain('the stale marketplace extension ID')
    expect(readme).toContain('packaged as a local VSIX')
  })
})
