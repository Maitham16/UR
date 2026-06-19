import { expect, test } from 'bun:test'
import {
  hasBlockingFindings,
  reviewDiff,
  summarizeFindings,
} from '../src/commands/agent-task/selfReview.ts'

function diff(file: string, addedLines: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,0 +1,' + addedLines.length + ' @@',
    ...addedLines.map(l => `+${l}`),
  ].join('\n')
}

test('clean diff yields no findings', () => {
  const findings = reviewDiff(diff('src/a.ts', ['const x = 1', 'export default x']))
  expect(findings).toEqual([])
  expect(hasBlockingFindings(findings)).toBe(false)
})

test('flags merge conflict markers as blocking', () => {
  const findings = reviewDiff(diff('src/a.ts', ['<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> branch']))
  expect(hasBlockingFindings(findings)).toBe(true)
  expect(findings.some(f => f.rule === 'merge-conflict')).toBe(true)
})

test('flags hardcoded secrets but not env reads', () => {
  const secret = reviewDiff(diff('src/cfg.ts', ['const apiKey = "abcdef123456"']))
  expect(secret.some(f => f.rule === 'hardcoded-secret' && f.severity === 'block')).toBe(true)

  const envRead = reviewDiff(diff('src/cfg.ts', ['const apiKey = process.env.API_KEY']))
  expect(envRead.some(f => f.rule === 'hardcoded-secret')).toBe(false)
})

test('flags AWS keys and private keys', () => {
  const fakeAwsKey = 'AKIA' + 'IOSFODNN7EXAMPLE'
  const aws = reviewDiff(diff('a.ts', [`const k = "${fakeAwsKey}"`]))
  expect(aws.some(f => f.rule === 'aws-access-key')).toBe(true)
  const fakePrivateKeyHeader = '-----BEGIN RSA ' + 'PRIVATE KEY-----'
  const pk = reviewDiff(diff('a.pem', [fakePrivateKeyHeader]))
  expect(pk.some(f => f.rule === 'private-key')).toBe(true)
})

test('flags focused tests as blocking', () => {
  const findings = reviewDiff(diff('a.test.ts', ['describe.only("x", () => {})', 'it.only("y", () => {})']))
  expect(findings.filter(f => f.rule === 'focused-test').length).toBe(2)
  expect(hasBlockingFindings(findings)).toBe(true)
})

test('warns on debugger and console.log without blocking', () => {
  const findings = reviewDiff(diff('a.ts', ['  debugger', '  console.log("hi")']))
  expect(findings.some(f => f.rule === 'debugger-statement' && f.severity === 'warn')).toBe(true)
  expect(findings.some(f => f.rule === 'console-log' && f.severity === 'warn')).toBe(true)
  expect(hasBlockingFindings(findings)).toBe(false)
})

test('only inspects added lines, not removed/context', () => {
  const d = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,1 @@',
    '-console.log("removed")',
    ' const ok = true',
  ].join('\n')
  const findings = reviewDiff(d)
  expect(findings).toEqual([])
})

test('tracks file and line numbers', () => {
  const findings = reviewDiff(diff('src/x.ts', ['ok', 'debugger']))
  const dbg = findings.find(f => f.rule === 'debugger-statement')
  expect(dbg?.file).toBe('src/x.ts')
  expect(dbg?.line).toBe(2)
})

test('summarizeFindings groups by severity', () => {
  const findings = reviewDiff(diff('a.test.ts', ['it.only("x", () => {})', 'console.log(1)', '// TODO later']))
  const summary = summarizeFindings(findings)
  expect(summary).toContain('BLOCKING')
  expect(summary).toContain('warning')
  expect(summary).toContain('info')
})
