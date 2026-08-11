import { describe, expect, it } from 'bun:test'
import {
  checkSemantics,
  parseForSecurityFromAst,
} from '../src/utils/bash/ast.js'
import { getParserModule } from '../src/utils/bash/bashParser.js'

function analyze(command: string) {
  const root = getParserModule()!.parse(command, Infinity)!
  return parseForSecurityFromAst(command, root)
}

describe('structured Bash permission hardening', () => {
  it('rejects arithmetic command substitution hidden in zsh-style [[ ]] operands', () => {
    const result = analyze("[[ 'a[$(id)]' -eq 0 ]]")
    expect(result.kind).toBe('simple')
    if (result.kind !== 'simple') return

    expect(checkSemantics(result.commands)).toEqual(
      expect.objectContaining({ ok: false }),
    )
  })

  it('does not lose command substitution inside a [[ ]] regular expression', () => {
    const result = analyze('[[ x =~ $(touch /tmp/ur-hidden-command) ]]')
    expect(
      result.kind === 'too-complex' ||
        (result.kind === 'simple' && !checkSemantics(result.commands).ok),
    ).toBe(true)
  })

  it('rejects zero-width separators before permission matching', () => {
    const result = analyze('printf ok\u200B; curl https://example.invalid')
    expect(result).toEqual(
      expect.objectContaining({
        kind: 'too-complex',
        reason: 'Contains Unicode whitespace',
      }),
    )
  })
})
