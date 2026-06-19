import { expect, test } from 'bun:test'
import {
  buildBwrapArgv,
  buildSeatbeltProfile,
  posixQuote,
  writableRoots,
} from '../src/utils/sandbox/sandboxProfile.ts'

test('posixQuote escapes single quotes safely', () => {
  expect(posixQuote('abc')).toBe("'abc'")
  expect(posixQuote("a'b")).toBe("'a'\\''b'")
  // round-trips through sh: 'a'\''b' is the string a'b
})

test('writableRoots always includes the workspace root and dedupes', () => {
  const roots = writableRoots('/work/project')
  expect(roots).toContain('/work/project')
  // No duplicates
  expect(new Set(roots).size).toBe(roots.length)
})

test('seatbelt profile confines writes to the workspace root', () => {
  const profile = buildSeatbeltProfile('/work/project', { denyNetwork: false })
  expect(profile).toContain('(version 1)')
  expect(profile).toContain('(allow default)')
  expect(profile).toContain('(deny file-write*)')
  expect(profile).toContain('(subpath "/work/project")')
  // Network not denied unless requested
  expect(profile).not.toContain('(deny network*)')
})

test('seatbelt profile denies network when requested', () => {
  const profile = buildSeatbeltProfile('/work/project', { denyNetwork: true })
  expect(profile).toContain('(deny network*)')
})

test('seatbelt profile escapes quotes/backslashes in paths', () => {
  const profile = buildSeatbeltProfile('/weird/pa"th', { denyNetwork: false })
  // The double quote must be escaped inside the SBPL string literal
  expect(profile).toContain('pa\\"th')
})

test('bwrap argv binds the workspace read-write over a read-only root', () => {
  const argv = buildBwrapArgv('/work/project', { denyNetwork: false })
  const joined = argv.join(' ')
  expect(joined).toContain('--ro-bind / /')
  expect(joined).toContain('--bind /work/project /work/project')
  expect(joined).toContain('--die-with-parent')
  expect(argv).not.toContain('--unshare-net')
})

test('bwrap argv unshares the network when requested', () => {
  const argv = buildBwrapArgv('/work/project', { denyNetwork: true })
  expect(argv).toContain('--unshare-net')
})
