import { expect, test } from 'bun:test'
import {
  parseExternalOutput,
  resolveDefaultExternalCommand,
} from '../src/services/repoEditing/ast/diagnostics.ts'

test('diagnostics defaults cover Python, Rust, and Go', () => {
  expect(resolveDefaultExternalCommand('python')).toContain('pyright')
  expect(resolveDefaultExternalCommand('rust')).toContain('cargo check')
  expect(resolveDefaultExternalCommand('go')).toContain('go vet')
})

test('parseExternalOutput reads pyright JSON diagnostics', () => {
  const parsed = parseExternalOutput(
    JSON.stringify({
      generalDiagnostics: [
        {
          file: 'src/app.py',
          severity: 'error',
          message: 'Type error',
          rule: 'reportGeneralTypeIssues',
          range: { start: { line: 2, character: 4 } },
        },
      ],
    }),
  )

  expect(parsed['src/app.py']?.[0]).toMatchObject({
    line: 3,
    column: 5,
    severity: 'error',
    message: 'Type error',
    code: 'reportGeneralTypeIssues',
  })
})

test('parseExternalOutput reads cargo JSON diagnostics', () => {
  const parsed = parseExternalOutput(
    JSON.stringify({
      reason: 'compiler-message',
      message: {
        level: 'error',
        message: 'cannot find value',
        code: { code: 'E0425' },
        spans: [
          {
            file_name: 'src/main.rs',
            line_start: 4,
            column_start: 9,
            is_primary: true,
          },
        ],
      },
    }),
  )

  expect(parsed['src/main.rs']?.[0]).toMatchObject({
    line: 4,
    column: 9,
    severity: 'error',
    message: 'cannot find value',
    code: 'E0425',
  })
})

test('parseExternalOutput reads plain go vet diagnostics', () => {
  const parsed = parseExternalOutput('pkg/main.go:12:3: unreachable code\n')

  expect(parsed['pkg/main.go']?.[0]).toMatchObject({
    line: 12,
    column: 3,
    severity: 'error',
    message: 'unreachable code',
  })
})
