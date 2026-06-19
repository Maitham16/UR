import { expect, test } from 'bun:test'
import * as React from 'react'
import {
  FallbackToolUseErrorMessage,
  formatFallbackToolUseError,
} from '../src/components/FallbackToolUseErrorMessage.tsx'
import { renderToString } from '../src/utils/staticRender.tsx'

const VALIDATION_ERROR =
  '<tool_use_error>InputValidationError: [\n' +
  '  {\n' +
  '    "code": "invalid_type",\n' +
  '    "path": ["allowedPrompts", 0],\n' +
  '    "message": "Expected object, received string"\n' +
  '  }\n' +
  ']</tool_use_error>'

test('validation errors keep a details hint when compacted', () => {
  const compact = formatFallbackToolUseError(VALIDATION_ERROR, false)

  expect(compact.error).toBe('Invalid tool parameters')
  expect(compact.showDetailsHint).toBe(true)

  const verbose = formatFallbackToolUseError(VALIDATION_ERROR, true)
  expect(verbose.error).toContain('InputValidationError')
  expect(verbose.error).toContain('allowedPrompts')
  expect(verbose.showDetailsHint).toBe(false)
})

test('compact validation error renders ctrl-o details hint', async () => {
  const compact = await renderToString(
    <FallbackToolUseErrorMessage result={VALIDATION_ERROR} verbose={false} />,
    100,
  )

  expect(compact).toContain('Invalid tool parameters')
  expect(compact).toContain('ctrl+o')
  expect(compact).toContain('to see details')
  expect(compact).not.toContain('allowedPrompts')

  const verbose = await renderToString(
    <FallbackToolUseErrorMessage result={VALIDATION_ERROR} verbose={true} />,
    100,
  )

  expect(verbose).toContain('InputValidationError')
  expect(verbose).toContain('allowedPrompts')
  expect(verbose).not.toContain('Invalid tool parameters')
  expect(verbose).not.toContain('ctrl+o')
})
