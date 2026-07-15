import { describe, expect, test } from 'bun:test'
import { readBoundedSecret } from '../src/utils/readSecretFromStdin.js'

async function* chunks(...values: Array<string | Buffer>): AsyncGenerator<string | Buffer> {
  for (const value of values) yield value
}

describe('bounded secret stdin reader', () => {
  test('joins chunks and trims only surrounding whitespace', async () => {
    await expect(readBoundedSecret(chunks('  abc', '123\n'))).resolves.toBe(
      'abc123',
    )
  })

  test('rejects oversized input before it can grow without bound', async () => {
    await expect(
      readBoundedSecret(chunks('123', '456'), {
        label: 'token',
        maxBytes: 5,
      }),
    ).rejects.toThrow('token from stdin exceeds 5 bytes')
  })

  test('rejects embedded NUL bytes', async () => {
    await expect(readBoundedSecret(chunks('abc\0def'))).rejects.toThrow(
      'contains a NUL byte',
    )
  })
})
