import { expect, test } from 'bun:test'
import { FileWriteTool } from '../src/tools/FileWriteTool/FileWriteTool.ts'

test('FileWriteTool normalizes body/text aliases for content', () => {
  const parsed = FileWriteTool.inputSchema.safeParse({
    file_path: '/tmp/example.txt',
    body: 'body content',
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data).toEqual({
    file_path: '/tmp/example.txt',
    content: 'body content',
  })
})

test('FileWriteTool normalizes filePath/path aliases for file_path', () => {
  const parsed = FileWriteTool.inputSchema.safeParse({
    filePath: '/tmp/example.ts',
    text: "console.log('ok')",
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data).toEqual({
    file_path: '/tmp/example.ts',
    content: "console.log('ok')",
  })
})

