import { expect, test } from 'bun:test'
import { getEditToolDescription } from '../src/tools/FileEditTool/prompt.ts'
import {
  findActualString,
  formatStringNotFoundMessage,
} from '../src/tools/FileEditTool/utils.ts'

test('Edit mismatch rejects a malformed HTML/JS cross-section and points to a verified JS anchor', () => {
  const file = [
    '<canvas id="game"></canvas>',
    '<script>',
    'const player = {',
    '  x: 120,',
    '  y: 240,',
    '  speed: 4,',
    '};',
    '</script>',
  ].join('\n')
  const malformedBlock = [
    '<!-- Player ship',
    'const player = {',
    '  x: 120,',
    '  y: 240,',
    '  speed: 4,',
    '};',
  ].join('\n')

  expect(findActualString(file, malformedBlock)).toBeNull()
  const message = formatStringNotFoundMessage(file, malformedBlock)

  expect(message).toContain('uniquely matches the current file at line 3')
  expect(message).toContain('complete 6-line block is not contiguous')
  expect(message).toContain('Re-read the target around line 3')
  expect(message).toContain('usually 2-4 lines')
  expect(message).toContain('do not retry this call unchanged')
})

test('Edit mismatch output bounds an over-large old_string', () => {
  const oldString = '<!-- Player ship -->\n' + 'stale JavaScript();\n'.repeat(100)
  const message = formatStringNotFoundMessage('unrelated file', oldString)

  expect(message).toContain('old_string preview truncated')
  expect(message).toContain(`${oldString.length} characters total`)
  expect(message.length).toBeLessThan(1_200)
  expect(message).not.toContain(oldString)
})

test('Edit prompt teaches small section-local replacements to every build', () => {
  const previousUserType = process.env.USER_TYPE
  delete process.env.USER_TYPE
  try {
    const prompt = getEditToolDescription()
    expect(prompt).toContain('current file as one exact, contiguous block')
    expect(prompt).toContain('re-read the target region')
    expect(prompt).toContain('never retry the unchanged call')
    expect(prompt).toContain('usually 2-4 adjacent lines')
    expect(prompt).toContain('distant HTML/CSS/JavaScript sections')
    expect(prompt).toContain('separate edits')
  } finally {
    if (previousUserType === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = previousUserType
  }
})
