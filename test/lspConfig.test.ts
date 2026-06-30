import { expect, test } from 'bun:test'
import { getBuiltInLspServers } from '../src/services/lsp/config.ts'

test('built-in LSP server configs cover TypeScript, Python, Rust, and Go', async () => {
  const installed = new Set([
    'typescript-language-server',
    'pyright-langserver',
    'rust-analyzer',
    'gopls',
  ])
  const servers = await getBuiltInLspServers({
    workspaceFolder: '/repo',
    binaryChecker: async command => installed.has(command),
  })

  expect(Object.keys(servers).sort()).toEqual([
    'builtin:go',
    'builtin:python',
    'builtin:rust',
    'builtin:typescript',
  ])
  expect(servers['builtin:typescript']?.command).toBe('typescript-language-server')
  expect(servers['builtin:typescript']?.args).toEqual(['--stdio'])
  expect(servers['builtin:typescript']?.extensionToLanguage['.ts']).toBe('typescript')
  expect(servers['builtin:python']?.command).toBe('pyright-langserver')
  expect(servers['builtin:python']?.extensionToLanguage['.py']).toBe('python')
  expect(servers['builtin:rust']?.command).toBe('rust-analyzer')
  expect(servers['builtin:rust']?.extensionToLanguage['.rs']).toBe('rust')
  expect(servers['builtin:go']?.command).toBe('gopls')
  expect(servers['builtin:go']?.extensionToLanguage['.go']).toBe('go')
})

test('built-in LSP skips servers whose binaries are not installed', async () => {
  const servers = await getBuiltInLspServers({
    workspaceFolder: '/repo',
    binaryChecker: async command => command === 'gopls',
  })

  expect(Object.keys(servers)).toEqual(['builtin:go'])
})
