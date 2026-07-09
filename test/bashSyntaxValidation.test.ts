import { describe, expect, test } from 'bun:test'
import { BashTool } from '../src/tools/BashTool/BashTool.js'
import type { ValidationResult } from '../src/Tool.js'

// validateInput does not read context in the quote-safety path, so a minimal
// stub is sufficient (mirrors the pattern in test/lifecycleHooks.test.ts).
const stubContext = {} as never

async function validate(command: string): Promise<ValidationResult> {
  return BashTool.validateInput!(
    { command } as never,
    stubContext,
  )
}

describe('BashTool.validateInput quote-safety', () => {
  test('rejects the user-reported unterminated-quote command with an actionable diagnostic', async () => {
    // Reproduces the user's actual failure class: a multi-line `python -c`
    // whose closing " was dropped across line wrapping, so bash fails with
    // "unexpected EOF while looking for matching `"`". The command below has
    // an odd number of " (the first `python -c "..."` never closes).
    const cmd = [
      'cp /tmp/new_data.py /home/maith/Desktop/test/data.py && python -c "import sys; sys.path.insert(0,\'/\'); from data import generate_samples; print(generate_samples(n=10)[2][:5])',
      '|| echo "Imported but output above shows syntax check result, try again if needed"',
    ].join(' ')

    const result = await validate(cmd)
    expect(result.result).toBe(false)
    if (!result.result) {
      const msg = result.message
      // Must name the defect so the model knows what to fix.
      expect(msg).toMatch(/unbalanced|unterminated/i)
      // Must suggest the heredoc fix for multi-line literals.
      expect(msg).toMatch(/heredoc/i)
      // Must tell the model not to repeat the identical command (breaks loops).
      expect(msg).toMatch(/do not retry/i)
      expect(result.errorCode).toBe(11)
    }
  })

  test('rejects a simple unterminated double quote', async () => {
    const result = await validate('echo "hello world')
    expect(result.result).toBe(false)
    if (!result.result) {
      expect(result.message).toMatch(/unbalanced|unterminated/i)
      expect(result.errorCode).toBe(11)
    }
  })

  test('rejects an unterminated single quote', async () => {
    const result = await validate("echo 'it does not close")
    expect(result.result).toBe(false)
    if (!result.result) {
      expect(result.message).toMatch(/unbalanced|unterminated/i)
    }
  })

  test('passes a well-formed command with balanced double quotes', async () => {
    const result = await validate('echo "hello world"')
    expect(result.result).toBe(true)
  })

  test('passes a command with nested single quotes inside double quotes', async () => {
    const result = await validate('python -c "print(\'hello\')"')
    expect(result.result).toBe(true)
  })

  test('passes an apostrophe inside double quotes (the common safe form)', async () => {
    // Models typically emit apostrophes inside double-quoted strings, which
    // is unambiguous and must always pass.
    const result = await validate('echo "it\'s fine"')
    expect(result.result).toBe(true)
  })

  test('passes the bash single-quote-escape idiom (it\'\'s)', async () => {
    // `echo 'it'\''s'` is the canonical bash idiom for an apostrophe inside
    // a single-quoted string. Must NOT be flagged as malformed.
    const result = await validate("echo 'it'\\''s'")
    expect(result.result).toBe(true)
  })

  test('passes a quoted heredoc used to feed python -c', async () => {
    const cmd = 'python -c "$(cat <<\'EOF\'\nprint(\'x\')\nEOF\n)"'
    const result = await validate(cmd)
    expect(result.result).toBe(true)
  })

  test('passes a compound command with balanced quotes across parts', async () => {
    const cmd = 'ls dir && echo "---" && ls dir2'
    const result = await validate(cmd)
    expect(result.result).toBe(true)
  })

  test('does not reject a command that merely contains a # comment', async () => {
    const result = await validate('echo "# not a comment-opening quote issue"')
    expect(result.result).toBe(true)
  })
})