import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('file-read policy context', () => {
  test('does not inject a blanket code-modification refusal into every read', () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        '..',
        'src',
        'tools',
        'FileReadTool',
        'FileReadTool.ts',
      ),
      'utf8',
    )

    expect(source).not.toContain('MUST refuse to improve or augment the code')
    expect(source).not.toContain('getFileReadSecurityReminder')
    expect(source).not.toContain('shouldIncludeFileReadMitigation')
  })
})
