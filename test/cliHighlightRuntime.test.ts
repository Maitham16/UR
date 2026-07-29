import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  getCliHighlightPromise,
  getLanguageName,
} from '../src/utils/cliHighlight.js'

test('declared highlighter loads and renders in the runtime', async () => {
  const highlighter = await getCliHighlightPromise()

  expect(highlighter).not.toBeNull()
  expect(highlighter?.supportsLanguage('typescript')).toBe(true)
  const highlighted = highlighter?.highlight('const answer: number = 42', {
    language: 'typescript',
    // Chalk respects terminal color detection. An explicit marker theme makes
    // this a deterministic proof that tokenization/rendering ran in CI too.
    theme: {
      keyword: text => `<keyword>${text}</keyword>`,
      number: text => `<number>${text}</number>`,
    },
  })
  expect(highlighted).toContain('<keyword>const</keyword>')
  expect(highlighted).toContain('<number>42</number>')
})

test('language metadata reads the highlight.js default registry', async () => {
  expect(await getLanguageName('/tmp/example.ts')).toBe('TypeScript')
  expect(await getLanguageName('/tmp/no-extension')).toBe('unknown')
})

test('the distributable bundle contains cli-highlight', () => {
  const bundle = readFileSync('dist/cli.js', 'utf8')

  expect(bundle).toContain('node_modules/cli-highlight/')
  expect(bundle).toContain('Syntax highlighting is unavailable:')
})
