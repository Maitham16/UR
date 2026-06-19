/**
 * .ur asset folder scaffolder.
 *
 * Generates a project-local `.ur/` directory holding the agent's assets:
 * docs, superpowers (skills), brainstorming notes, memory, and prompts.
 * Idempotent and non-destructive: existing files are never overwritten.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface UrAssetsResult {
  root: string
  created: string[]
  skipped: string[]
}

interface SeedFile {
  path: string // relative to .ur
  content: string
}

const SEED_FILES: SeedFile[] = [
  {
    path: 'README.md',
    content: `# .ur

Project-local assets for the UR agent. UR reads from and writes to this folder.

- \`docs/\`          — documentation about this project and the agent
- \`superpowers/\`   — reusable skills/superpowers the agent can apply
- \`brainstorming/\` — scratch space for ideas and plans
- \`memory/\`        — persistent memory carried across sessions
- \`prompts/\`       — prompt assets (system prompt, snippets)
`,
  },
  {
    path: 'config.json',
    content: `${JSON.stringify(
      {
        version: 1,
        assets: ['docs', 'superpowers', 'brainstorming', 'memory', 'prompts'],
        createdBy: 'ur',
      },
      null,
      2,
    )}\n`,
  },
  {
    path: 'docs/agent.md',
    content: `# Agent documentation

Describe what this agent does, how it is configured, and any project-specific
conventions it should follow.
`,
  },
  {
    path: 'superpowers/README.md',
    content: `# Superpowers

Drop reusable skills here — focused capabilities the agent can pull in on demand
(one Markdown file per superpower). Each file should explain *when to use it* and
*how to apply it*.
`,
  },
  {
    path: 'brainstorming/README.md',
    content: `# Brainstorming

Free-form space for ideas, designs, and plans. Nothing here is binding — it is
working memory for thinking through problems.
`,
  },
  {
    path: 'memory/memory.md',
    content: `# Memory

Durable facts and decisions the agent should remember across sessions. Keep it
concise and current; prune anything stale.
`,
  },
  {
    path: 'prompts/system.md',
    content: `# System prompt assets

Reusable prompt fragments and the project system prompt live here.
`,
  },
]

/** Subdirectories created under .ur (even if their seed files already exist). */
const DIRS = ['docs', 'superpowers', 'brainstorming', 'memory', 'prompts']

/**
 * Create the .ur asset folder under `cwd`. Existing files are preserved.
 * Returns which files were created vs. already present.
 */
export function scaffoldUrAssets(cwd: string): UrAssetsResult {
  const root = join(cwd, '.ur')
  const created: string[] = []
  const skipped: string[] = []

  mkdirSync(root, { recursive: true })
  for (const d of DIRS) mkdirSync(join(root, d), { recursive: true })

  for (const file of SEED_FILES) {
    const full = join(root, file.path)
    if (existsSync(full)) {
      skipped.push(file.path)
      continue
    }
    writeFileSync(full, file.content)
    created.push(file.path)
  }

  return { root, created, skipped }
}

/** Human-readable summary of a scaffold run. */
export function formatUrAssetsResult(r: UrAssetsResult): string {
  const lines = [`.ur ready at ${r.root}`]
  if (r.created.length) lines.push(`created: ${r.created.join(', ')}`)
  if (r.skipped.length) lines.push(`kept existing: ${r.skipped.join(', ')}`)
  return lines.join('\n')
}
