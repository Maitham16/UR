import { describe, expect, test } from 'bun:test'
import { BashTool } from '../src/tools/BashTool/BashTool.js'
import { interpretCommandResult } from '../src/tools/BashTool/commandSemantics.js'

describe('Bash search command semantics', () => {
  test('turns an absent grep target into an actionable no-match result', () => {
    const interpretation = interpretCommandResult(
      'grep -n version Makefile',
      2,
      '',
      'grep: Makefile: No such file or directory\n',
    )
    expect(interpretation).toEqual({
      isError: false,
      message:
        'No matching files found: `Makefile`. The requested search target does not exist; discover available files with `rg --files` before retrying.',
      displayStdout: '',
      displayStderr: '',
    })

    const modelBlock = BashTool.mapToolResultToToolResultBlockParam(
      {
        stdout: '',
        stderr: '',
        interrupted: false,
        returnCodeInterpretation: interpretation.message,
      },
      'missing-makefile',
    )
    expect(modelBlock.content).toContain('`Makefile`')
    expect(modelBlock.content).toContain('`rg --files`')
  })

  test('supports ripgrep IO diagnostics and deduplicates missing targets', () => {
    const result = interpretCommandResult(
      'rg version Makefile package.mk Makefile',
      2,
      '',
      [
        'rg: Makefile: IO error for operation on Makefile: No such file or directory (os error 2)',
        'rg: package.mk: No such file or directory (os error 2)',
        'rg: Makefile: IO error for operation on Makefile: No such file or directory (os error 2)',
      ].join('\n'),
    )

    expect(result.isError).toBe(false)
    expect(result.message).toContain('`Makefile`, `package.mk`')
    expect(result.displayStderr).toBe('')
  })

  test('does not hide permission, syntax, mixed-output, or compound-command failures', () => {
    expect(
      interpretCommandResult('grep x private.txt', 2, '', 'grep: private.txt: Permission denied\n').isError,
    ).toBe(true)
    expect(
      interpretCommandResult('grep x good.txt missing.txt', 2, 'x\n', 'grep: missing.txt: No such file or directory\n').isError,
    ).toBe(true)
    expect(
      interpretCommandResult('echo ready; grep x Makefile', 2, '', 'grep: Makefile: No such file or directory\n').isError,
    ).toBe(true)
  })

  test('keeps ordinary no-match exits successful', () => {
    expect(interpretCommandResult('rg absent src', 1, '', '')).toEqual({
      isError: false,
      message: 'No matches found',
    })
  })
})
