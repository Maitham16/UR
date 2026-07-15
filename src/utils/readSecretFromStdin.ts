const DEFAULT_MAX_SECRET_BYTES = 64 * 1024

export async function readBoundedSecret(
  stream: AsyncIterable<string | Buffer | Uint8Array>,
  options: { label?: string; maxBytes?: number } = {},
): Promise<string> {
  const label = options.label ?? 'secret'
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SECRET_BYTES
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > maxBytes) {
      throw new Error(`${label} from stdin exceeds ${maxBytes} bytes`)
    }
    chunks.push(buffer)
  }

  const value = Buffer.concat(chunks, totalBytes).toString('utf8').trim()
  if (value.includes('\0')) {
    throw new Error(`${label} from stdin contains a NUL byte`)
  }
  return value
}

export async function readSecretFromStdin(
  options: { label?: string; maxBytes?: number } = {},
): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  return readBoundedSecret(process.stdin, options)
}
