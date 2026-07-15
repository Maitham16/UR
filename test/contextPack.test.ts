import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import {
  appendTaskMemory,
  architectureSummaryPath,
  compressTaskMemory,
  projectManifestPath,
  writeProjectContextManifest,
} from '../src/services/context/projectContextManifest.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeProject(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'context-pack-fixture',
      scripts: {
        typecheck: 'tsc --noEmit',
        test: 'bun test',
      },
    }),
  )
  writeFileSync(join(dir, 'bun.lock'), '')
  writeFileSync(join(dir, 'AGENTS.md'), 'Use repository scripts.\n')
  writeFileSync(join(dir, 'UR.md'), 'Keep task decisions.\n')
  writeFileSync(join(dir, '.cursorrules'), 'Prefer project rules.\n')
  mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true })
  writeFileSync(join(dir, '.cursor', 'rules', 'architecture.mdc'), 'Layer boundaries.\n')
  mkdirSync(join(dir, '.github'), { recursive: true })
  writeFileSync(join(dir, '.github', 'copilot-instructions.md'), 'Use tests first.\n')
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
  mkdirSync(join(dir, '.ur'), { recursive: true })
  writeFileSync(join(dir, '.ur', 'verify.json'), '{"afterEdit":["bun test"]}\n')
  writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{}}\n')
  writeFileSync(join(dir, 'Dockerfile'), 'FROM scratch\n')
  writeFileSync(join(dir, 'tsconfig.json'), '{}')
}

describe('project context pack', () => {
  test('writes an architecture manifest from project files and commands', () => {
    const dir = tempDir('ur-context-manifest-')
    try {
      writeProject(dir)
      const manifest = writeProjectContextManifest(dir)
      expect(manifest.project.name).toBe('context-pack-fixture')
      expect(manifest.instructionFiles).toContain('AGENTS.md')
      expect(manifest.instructionFiles).toContain('.cursorrules')
      expect(manifest.instructionFiles).toContain('.cursor/rules/architecture.mdc')
      expect(manifest.instructionFiles).toContain('.github/copilot-instructions.md')
      expect(manifest.manifests).toContain('package.json')
      expect(manifest.manifests).toContain('.mcp.json')
      expect(manifest.manifests).toContain('.ur/verify.json')
      expect(manifest.manifests).toContain('.github/workflows/ci.yml')
      expect(manifest.manifests).toContain('Dockerfile')
      expect(manifest.commands.compile).toContain('bun run typecheck')
      expect(manifest.commands.test).toContain('bun run test')
      expect(existsSync(projectManifestPath(dir))).toBe(true)
      const architecture = readFileSync(architectureSummaryPath(dir), 'utf8')
      expect(architecture).toContain('Architecture Rules')
      expect(architecture).toContain('Cursor rules')
      expect(architecture).toContain('.github/workflows/ci.yml')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('records task memory and compresses old context by kind', () => {
    const dir = tempDir('ur-context-memory-')
    try {
      appendTaskMemory(dir, 'decision', 'Use Bun scripts for checks.')
      appendTaskMemory(dir, 'constraint', 'Do not expose secret values.')
      appendTaskMemory(dir, 'diff', 'Updated the safety policy evaluator.')
      const compressed = compressTaskMemory(dir)
      expect(compressed).toContain('## Decisions')
      expect(compressed).toContain('Use Bun scripts for checks.')
      expect(compressed).toContain('Do not expose secret values.')
      expect(compressed).toContain('Updated the safety policy evaluator.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('context-pack command scans and remembers decisions', async () => {
    const dir = tempDir('ur-context-command-')
    try {
      writeProject(dir)
      const { call } = await import('../src/commands/context-pack/context-pack.js')
      const scan = await runWithCwdOverride(dir, () => call('scan', {} as never))
      expect(scan.type).toBe('text')
      if (scan.type !== 'text') throw new Error('expected text')
      expect(scan.value).toContain('.ur/project-manifest.json')

      const remembered = await runWithCwdOverride(dir, () =>
        call('remember --decision "Use manifest commands first"', {} as never),
      )
      expect(remembered.type).toBe('text')
      if (remembered.type !== 'text') throw new Error('expected text')
      expect(remembered.value).toContain('Recorded decision')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('context-pack verifies and rolls back protected memory without exposing content', async () => {
    const dir = tempDir('ur-context-memory-command-')
    try {
      const first = appendTaskMemory(dir, 'decision', 'private first decision')
      appendTaskMemory(dir, 'decision', 'private second decision')
      const { call } = await import('../src/commands/context-pack/context-pack.js')
      const verified = await runWithCwdOverride(dir, () =>
        call('memory verify --json', {} as never),
      )
      if (verified.type !== 'text') throw new Error('expected text')
      const report = JSON.parse(verified.value)
      expect(report.valid).toBe(true)
      expect(report.entryCount).toBe(2)
      expect(verified.value).not.toContain('private first decision')

      const rollback = await runWithCwdOverride(dir, () =>
        call(`memory rollback --to ${first.id} --json`, {} as never),
      )
      if (rollback.type !== 'text') throw new Error('expected text')
      expect(JSON.parse(rollback.value).removedEntries).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
