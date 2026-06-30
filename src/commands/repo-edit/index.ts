import type { Command } from '../../types/command.js'

const repoEdit = {
  type: 'local',
  name: 'repo-edit',
  aliases: ['repoedit', 'reliable-edit'],
  description:
    'Reliable repo editing: indexed search, binding-aware rename via TypeScript compiler API, patch previews, and rollback-safe apply',
  argumentHint:
    'index|search <query>|plan/preview/apply rename <from> --to <to>|rename <from> --to <to> [--file <path>] [--engine ts|lsp|treesitter] [--check <cmd>] [--json]|move <symbol> --to <target> --file <source> [--check <cmd>] [--json]|organize-imports [--file <path>] [--check <cmd>] [--json]|unused [--file <path>] [--json]|callers <symbol> [--file <path>] [--json]',
  supportsNonInteractive: true,
  load: () => import('./repo-edit.js'),
} satisfies Command

export default repoEdit
