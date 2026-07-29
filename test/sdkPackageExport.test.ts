import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

test('package exports a built and typed ur-agent/sdk entrypoint', () => {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8'),
  ) as {
    exports?: Record<
      string,
      {
        types?: string
        import?: string
        require?: string
        default?: string
      }
    >
  }
  const sdk = pkg.exports?.['./sdk']

  expect(sdk).toEqual({
    types: './dist/sdk/index.d.ts',
    import: './dist/sdk/index.js',
    require: './dist/sdk/index.cjs',
    default: './dist/sdk/index.js',
  })
  for (const path of [sdk?.types, sdk?.import, sdk?.require, sdk?.default]) {
    expect(typeof path).toBe('string')
    expect(existsSync(join(ROOT, path!))).toBe(true)
  }
})

test('Node resolves both ESM and CommonJS consumers through ur-agent/sdk', () => {
  const esm = spawnSync(
    'node',
    [
      '--input-type=module',
      '--eval',
      "import { parseResultText, UrClient } from 'ur-agent/sdk'; const empty = parseResultText('[{\"type\":\"result\",\"result\":\"\"}]'); console.log(parseResultText('{\"result\":\"esm\"}'), JSON.stringify(empty), typeof UrClient)",
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  expect(esm.status, esm.stderr).toBe(0)
  expect(esm.stdout.trim()).toBe('esm "" function')

  const commonjs = spawnSync(
    'node',
    [
      '--eval',
      "const { parseResultText, UrClient } = require('ur-agent/sdk'); const empty = parseResultText('[{\"type\":\"result\",\"result\":\"\"}]'); console.log(parseResultText('{\"result\":\"cjs\"}'), JSON.stringify(empty), typeof UrClient)",
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  expect(commonjs.status, commonjs.stderr).toBe(0)
  expect(commonjs.stdout.trim()).toBe('cjs "" function')
})
