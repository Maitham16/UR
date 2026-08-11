import { describe, expect, it } from 'bun:test'
import { getEmptyToolPermissionContext } from '../src/Tool.js'
import { checkPathConstraints } from '../src/tools/PowerShellTool/pathValidation.js'
import type { ParsedPowerShellCommand } from '../src/utils/powershell/parser.js'
import { transformCommandAst } from '../src/utils/powershell/parser.js'

function parsedPathCommand(path: string): ParsedPowerShellCommand {
  return {
    valid: true,
    errors: [],
    variables: [],
    hasStopParsing: false,
    originalCommand: `Get-Content ${path}`,
    statements: [
      {
        statementType: 'PipelineAst',
        text: `Get-Content ${path}`,
        redirections: [],
        commands: [
          {
            name: 'Get-Content',
            nameType: 'cmdlet',
            elementType: 'CommandAst',
            args: [path],
            text: `Get-Content ${path}`,
            elementTypes: ['StringConstant', 'StringConstant'],
          },
        ],
      },
    ],
  }
}

describe('PowerShell quote hardening', () => {
  it('uses the AST-resolved value for quoted command names and paths', () => {
    const transformed = transformCommandAst({
      type: 'CommandAst',
      text: `& 'Get-Content' 'folder/file.txt'`,
      commandElements: [
        {
          type: 'StringConstantExpressionAst',
          text: `'Get-Content'`,
          value: 'Get-Content',
        },
        {
          type: 'StringConstantExpressionAst',
          text: `'folder/file.txt'`,
          value: 'folder/file.txt',
        },
      ],
    })

    expect(transformed.name).toBe('Get-Content')
    expect(transformed.args).toEqual(['folder/file.txt'])
  })

  it('requires approval for residual quote characters inside a path', () => {
    const result = checkPathConstraints(
      { command: `Get-Content "safe'fragment"` },
      parsedPathCommand("safe'fragment"),
      getEmptyToolPermissionContext(),
    )

    expect(result.behavior).toBe('ask')
    expect('message' in result ? result.message : '').toContain(
      'Quote characters inside PowerShell paths',
    )
  })
})
