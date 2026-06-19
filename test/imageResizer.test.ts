import { describe, expect, test } from 'bun:test'
import {
  ImageResizeError,
  maybeResizeAndDownsampleImageBuffer,
} from '../src/utils/imageResizer.js'

function fakePngWithDimensions(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer[0] = 0x89
  buffer[1] = 0x50
  buffer[2] = 0x4e
  buffer[3] = 0x47
  buffer[4] = 0x0d
  buffer[5] = 0x0a
  buffer[6] = 0x1a
  buffer[7] = 0x0a
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

describe('image resizer fallback', () => {
  test('passes through under-limit oversized PNGs when local resize fails', async () => {
    const image = fakePngWithDimensions(4000, 3000)

    const result = await maybeResizeAndDownsampleImageBuffer(
      image,
      image.length,
      'png',
    )

    expect(result.buffer).toEqual(image)
    expect(result.mediaType).toBe('png')
  })

  test('still rejects empty images', async () => {
    await expect(
      maybeResizeAndDownsampleImageBuffer(Buffer.alloc(0), 0, 'png'),
    ).rejects.toThrow(ImageResizeError)
  })
})
