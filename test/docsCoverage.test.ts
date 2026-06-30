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
})
