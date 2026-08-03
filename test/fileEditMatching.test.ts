import { describe, expect, test } from 'bun:test'
import {
  describeEditMatchFailure,
  findEditTarget,
  shiftIndentation,
} from '../src/tools/FileEditTool/utils.js'

const FILE = [
  'class Service {',
  '    async run(input) {',
  '        const result = await this.fetch(input)',
  '        return result.value',
  '    }',
  '}',
].join('\n')

describe('edit target resolution', () => {
  test('an exact match is returned unchanged', () => {
    expect(findEditTarget(FILE, '        return result.value')).toEqual({
      actual: '        return result.value',
      indentShift: 0,
    })
  })

  test('a block the model re-indented still resolves, with the shift reported', () => {
    const target = findEditTarget(
      FILE,
      ['  const result = await this.fetch(input)', '  return result.value'].join(
        '\n',
      ),
    )

    expect(target).toEqual({
      actual: [
        '        const result = await this.fetch(input)',
        '        return result.value',
      ].join('\n'),
      indentShift: 6,
    })
    // The returned text is the file's own, so replace() finds it.
    expect(FILE.includes(target!.actual)).toBe(true)
  })

  test('the replacement lands at the file depth, not the model depth', () => {
    const target = findEditTarget(FILE, '  return result.value')!
    const replacement = shiftIndentation(
      '  return result.value ?? null',
      target.indentShift,
    )

    expect(FILE.replace(target.actual, replacement)).toContain(
      '        return result.value ?? null',
    )
  })

  test("Read's line-number gutter is recovered in both render formats", () => {
    expect(
      findEditTarget(FILE, '     4→        return result.value')?.actual,
    ).toBe('        return result.value')
    expect(findEditTarget(FILE, '4\t        return result.value')?.actual).toBe(
      '        return result.value',
    )
  })

  test('non-breaking and zero-width characters do not defeat a match', () => {
    expect(findEditTarget('const x = 1', 'const x = 1')?.actual).toBe(
      'const x = 1',
    )
    expect(findEditTarget('const a​ = 5', 'const a = 5')?.actual).toBe(
      'const a​ = 5',
    )
  })
})

describe('edit target resolution does not retarget edits', () => {
  test('an exact match wins over a shifted one elsewhere in the file', () => {
    const ambiguous = [
      'function a() {',
      '  return 1',
      '}',
      'function b() {',
      '      return 1',
      '}',
    ].join('\n')

    expect(findEditTarget(ambiguous, '  return 1')).toEqual({
      actual: '  return 1',
      indentShift: 0,
    })
  })

  test('a non-uniform indentation difference is rejected', () => {
    expect(
      findEditTarget(['      alpha', '    beta'].join('\n'), ['  alpha', '  beta'].join('\n')),
    ).toBeNull()
  })

  test('a blank search string matches nothing', () => {
    expect(findEditTarget(FILE, '   \n  ')).toBeNull()
  })

  test('text that is genuinely absent still fails', () => {
    expect(findEditTarget(FILE, 'return result.missing')).toBeNull()
  })
})

describe('shiftIndentation', () => {
  test('dedents, clamping at column zero', () => {
    expect(shiftIndentation('      a\n      b', -4)).toBe('  a\n  b')
    expect(shiftIndentation('  a', -8)).toBe('a')
  })

  test('leaves blank lines free of trailing indentation', () => {
    expect(shiftIndentation('a\n\nb', 2)).toBe('  a\n\n  b')
  })
})

describe('edit failure diagnosis', () => {
  test('names the missing first line when nothing anchors', () => {
    expect(describeEditMatchFailure(FILE, 'return result.missing')).toContain(
      'No line in the file matches its first line',
    )
  })

  test('points at the line where the block diverges', () => {
    const message = describeEditMatchFailure(
      FILE,
      ['        return result.value', '        console.log(1)'].join('\n'),
    )

    expect(message).toMatch(/line \d+: file has/)
    expect(message).toContain('console.log(1)')
  })
})
