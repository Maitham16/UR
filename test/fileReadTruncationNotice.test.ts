import { describe, expect, test } from 'bun:test'
import { FileReadTool } from '../src/tools/FileReadTool/FileReadTool.js'
import { MAX_LINES_TO_READ } from '../src/tools/FileReadTool/prompt.js'

function resultText(data: unknown): string {
  const block = FileReadTool.mapToolResultToToolResultBlockParam!(
    data as never,
    'test-tool-use',
  )
  const content = (block as { content: unknown }).content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

function textResult(file: {
  content: string
  startLine: number
  numLines: number
  totalLines: number
}): string {
  return resultText({
    type: 'text' as const,
    file: { filePath: '/tmp/sample.ts', ...file },
  })
}

/**
 * A read that stopped at the line cap used to be indistinguishable from a read
 * of the whole file, so concluding "this code is not in here" from a partial
 * view was a reasonable inference from what the model was shown.
 */
describe('Read reports when it did not return the whole file', () => {
  test('a truncated read says which lines it returned and where to resume', () => {
    const text = textResult({
      content: 'a\nb\nc\n',
      startLine: 1,
      numLines: 2000,
      totalLines: 5000,
    })

    expect(text).toContain('lines 1-2000 of 5000')
    expect(text).toContain('3000 lines were not returned')
    expect(text).toContain('offset 2001')
  })

  test('a complete read says nothing', () => {
    const text = textResult({
      content: 'a\nb\nc\n',
      startLine: 1,
      numLines: 42,
      totalLines: 42,
    })

    expect(text).not.toContain('were not returned')
  })

  test('the final page of a paginated read says nothing', () => {
    const text = textResult({
      content: 'a\n',
      startLine: 4001,
      numLines: 1000,
      totalLines: 5000,
    })

    expect(text).not.toContain('were not returned')
  })

  test('a middle page points at the next offset, not the start', () => {
    const text = textResult({
      content: 'a\n',
      startLine: 2001,
      numLines: 2000,
      totalLines: 5000,
    })

    expect(text).toContain('lines 2001-4000 of 5000')
    expect(text).toContain('offset 4001')
  })

  test('the default line cap is what a large file is measured against', () => {
    // Guards the pairing between the cap the prompt advertises and the notice:
    // a file one line longer than the cap must report a remainder.
    const text = textResult({
      content: 'a\n',
      startLine: 1,
      numLines: MAX_LINES_TO_READ,
      totalLines: MAX_LINES_TO_READ + 1,
    })

    expect(text).toContain(`of ${MAX_LINES_TO_READ + 1}`)
    expect(text).toContain('1 lines were not returned')
  })
})
