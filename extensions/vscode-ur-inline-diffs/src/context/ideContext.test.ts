import { describe, expect, test } from 'bun:test'
import {
  buildPromptWithAttachments,
  describeUnavailableReason,
  formatAttachmentBlock,
  formatAttachmentLabel,
  type ContextAttachment,
  type EditorSnapshot,
} from './ideContext.js'

const file: ContextAttachment = { kind: 'file', file: { path: 'src/foo.ts', languageId: 'typescript' } }

const selection: ContextAttachment = {
  kind: 'selection',
  selection: { path: 'src/foo.ts', languageId: 'typescript', startLine: 12, endLine: 40, text: 'const x = 1' },
}

const singleLineSelection: ContextAttachment = {
  kind: 'selection',
  selection: { path: 'src/foo.ts', languageId: 'python', startLine: 7, endLine: 7, text: 'x = 1' },
}

describe('formatAttachmentLabel', () => {
  test('whole-file attachment has no line range', () => {
    expect(formatAttachmentLabel(file)).toBe('@src/foo.ts')
  })

  test('multi-line selection includes a line range', () => {
    expect(formatAttachmentLabel(selection)).toBe('@src/foo.ts:12-40')
  })

  test('single-line selection collapses to one line number', () => {
    expect(formatAttachmentLabel(singleLineSelection)).toBe('@src/foo.ts:7')
  })
})

describe('formatAttachmentBlock', () => {
  test('file block is just the label, no fenced code', () => {
    expect(formatAttachmentBlock(file)).toBe('@src/foo.ts')
  })

  test('selection block includes a fenced code block with the language id', () => {
    const block = formatAttachmentBlock(selection)
    expect(block).toBe('@src/foo.ts:12-40\n```typescript\nconst x = 1\n```')
  })

  test('maps VS Code-specific language ids to conventional fence names', () => {
    const tsx: ContextAttachment = {
      kind: 'selection',
      selection: { path: 'src/App.tsx', languageId: 'typescriptreact', startLine: 1, endLine: 1, text: '<App />' },
    }
    expect(formatAttachmentBlock(tsx)).toContain('```tsx\n')

    const shell: ContextAttachment = {
      kind: 'selection',
      selection: { path: 'run.sh', languageId: 'shellscript', startLine: 1, endLine: 1, text: 'echo hi' },
    }
    expect(formatAttachmentBlock(shell)).toContain('```bash\n')
  })
})

describe('buildPromptWithAttachments', () => {
  test('returns the prompt unchanged with no attachments', () => {
    expect(buildPromptWithAttachments('Explain this', [])).toBe('Explain this')
  })

  test('prepends attachment blocks before the prompt, never hides them', () => {
    const result = buildPromptWithAttachments('Explain this', [selection])
    expect(result).toBe('@src/foo.ts:12-40\n```typescript\nconst x = 1\n```\n\nExplain this')
  })

  test('joins multiple attachments in order', () => {
    const result = buildPromptWithAttachments('Compare these', [file, singleLineSelection])
    expect(result.startsWith('@src/foo.ts\n\n@src/foo.ts:7')).toBe(true)
    expect(result.endsWith('Compare these')).toBe(true)
  })
})

describe('describeUnavailableReason', () => {
  test('no workspace open', () => {
    const snapshot: EditorSnapshot = {}
    expect(describeUnavailableReason(snapshot, 'file')).toBe('Open a workspace folder first.')
    expect(describeUnavailableReason(snapshot, 'selection')).toBe('Open a workspace folder first.')
  })

  test('workspace open, no active editor', () => {
    const snapshot: EditorSnapshot = { workspaceRoot: '/work' }
    expect(describeUnavailableReason(snapshot, 'file')).toBe('No active editor.')
  })

  test('active editor, no selection', () => {
    const snapshot: EditorSnapshot = {
      workspaceRoot: '/work',
      activeFile: { path: 'src/foo.ts', languageId: 'typescript' },
    }
    expect(describeUnavailableReason(snapshot, 'selection')).toBe('No text selected.')
  })

  test('active editor is enough for a file attachment', () => {
    const snapshot: EditorSnapshot = {
      workspaceRoot: '/work',
      activeFile: { path: 'src/foo.ts', languageId: 'typescript' },
    }
    expect(describeUnavailableReason(snapshot, 'file')).toBeNull()
  })

  test('fully populated snapshot has no unavailable reason for either kind', () => {
    const snapshot: EditorSnapshot = {
      workspaceRoot: '/work',
      activeFile: { path: 'src/foo.ts', languageId: 'typescript' },
      selection: { path: 'src/foo.ts', languageId: 'typescript', startLine: 1, endLine: 2, text: 'x' },
    }
    expect(describeUnavailableReason(snapshot, 'file')).toBeNull()
    expect(describeUnavailableReason(snapshot, 'selection')).toBeNull()
  })
})
