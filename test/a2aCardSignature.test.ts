import { describe, expect, test } from 'bun:test'
import {
  A2A_CARD_SIGNATURE_ALG,
  agentCardKeyId,
  canonicalizeJson,
  generateAgentCardSigningKey,
  signAgentCard,
  verifyAgentCard,
  verifyAgentCardSignature,
  withAgentCardSignature,
} from '../src/services/agents/a2aCardSignature.js'
import { buildA2AV1AgentCard } from '../src/services/agents/trends.js'

const key = generateAgentCardSigningKey()

function decodeProtected(encoded: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
}

describe('canonicalizeJson', () => {
  test('sorts object keys so key order cannot change the signed bytes', () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalizeJson({ a: 2, b: 1 })).toBe(canonicalizeJson({ b: 1, a: 2 }))
  })

  test('sorts nested keys and preserves array order', () => {
    expect(canonicalizeJson({ z: { y: 1, x: 2 }, list: [3, 1, 2] })).toBe(
      '{"list":[3,1,2],"z":{"x":2,"y":1}}',
    )
  })

  test('omits undefined members rather than emitting null', () => {
    expect(canonicalizeJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  test('rejects non-finite numbers instead of coercing them to null', () => {
    expect(() => canonicalizeJson({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/)
    expect(() => canonicalizeJson({ a: Number.NaN })).toThrow(/non-finite/)
  })

  test('escapes strings via JSON rules', () => {
    expect(canonicalizeJson({ a: 'q"\n' })).toBe('{"a":"q\\"\\n"}')
  })
})

describe('signAgentCard', () => {
  test('publishes EdDSA and the kid in the protected header', () => {
    const signature = signAgentCard({ name: 'UR' }, key)
    const header = decodeProtected(signature.protected)
    expect(header.alg).toBe(A2A_CARD_SIGNATURE_ALG)
    expect(header.kid).toBe(key.kid)
  })

  test('omits kid when the signer did not supply one', () => {
    const signature = signAgentCard({ name: 'UR' }, { privateKeyPem: key.privateKeyPem })
    expect(decodeProtected(signature.protected).kid).toBeUndefined()
  })

  test('is deterministic for the same card and key', () => {
    const card = { name: 'UR', skills: ['a', 'b'] }
    expect(signAgentCard(card, key).signature).toBe(signAgentCard(card, key).signature)
  })

  test('ignores key order in the card', () => {
    const a = signAgentCard({ name: 'UR', version: '1' }, key)
    const b = signAgentCard({ version: '1', name: 'UR' }, key)
    expect(a.signature).toBe(b.signature)
  })

  test('rejects a non-Ed25519 private key', () => {
    const rsa = generateAgentCardSigningKeyRsa()
    expect(() => signAgentCard({ name: 'UR' }, { privateKeyPem: rsa })).toThrow(/Ed25519/)
  })
})

describe('verifyAgentCardSignature', () => {
  test('verifies a signature over the same card', () => {
    const card = { name: 'UR', version: '1.49.0' }
    const signature = signAgentCard(card, key)
    expect(verifyAgentCardSignature(card, signature, key.publicKeyPem)).toEqual({
      status: 'valid',
      kid: key.kid,
    })
  })

  test('verifies regardless of the key order of the parsed card', () => {
    const signature = signAgentCard({ name: 'UR', version: '1' }, key)
    const reparsed = JSON.parse('{"version":"1","name":"UR"}')
    expect(verifyAgentCardSignature(reparsed, signature, key.publicKeyPem).status).toBe('valid')
  })

  test('ignores existing signatures when recomputing the payload', () => {
    const card = { name: 'UR' }
    const signed = withAgentCardSignature(card, key)
    const [signature] = signed.signatures
    expect(verifyAgentCardSignature(signed, signature, key.publicKeyPem).status).toBe('valid')
  })

  test('rejects a tampered field', () => {
    const card = { name: 'UR', url: 'https://good.example' }
    const signature = signAgentCard(card, key)
    const tampered = { ...card, url: 'https://evil.example' }
    const result = verifyAgentCardSignature(tampered, signature, key.publicKeyPem)
    expect(result).toEqual({ status: 'invalid', reason: 'signature does not match the card' })
  })

  test('rejects an added field', () => {
    const card = { name: 'UR' }
    const signature = signAgentCard(card, key)
    const result = verifyAgentCardSignature({ ...card, extra: true }, signature, key.publicKeyPem)
    expect(result.status).toBe('invalid')
  })

  test('rejects a signature from a different key', () => {
    const other = generateAgentCardSigningKey()
    const card = { name: 'UR' }
    const signature = signAgentCard(card, other)
    expect(verifyAgentCardSignature(card, signature, key.publicKeyPem).status).toBe('invalid')
  })

  test('rejects an algorithm-substituted header', () => {
    const card = { name: 'UR' }
    const signature = signAgentCard(card, key)
    const forged = {
      ...signature,
      protected: Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8').toString('base64url'),
    }
    const result = verifyAgentCardSignature(card, forged, key.publicKeyPem)
    expect(result).toEqual({
      status: 'invalid',
      reason: 'unsupported signature algorithm: none',
    })
  })

  test('rejects a malformed protected header', () => {
    const result = verifyAgentCardSignature(
      { name: 'UR' },
      { protected: 'not-json', signature: 'AAAA' },
      key.publicKeyPem,
    )
    expect(result.status).toBe('invalid')
    expect(result).toMatchObject({ reason: expect.stringContaining('base64url') })
  })

  test('reports missing signature members instead of throwing', () => {
    const result = verifyAgentCardSignature(
      { name: 'UR' },
      { protected: '', signature: undefined as unknown as string },
      key.publicKeyPem,
    )
    expect(result.status).toBe('invalid')
  })

  test('rejects an unparseable public key', () => {
    const signature = signAgentCard({ name: 'UR' }, key)
    const result = verifyAgentCardSignature({ name: 'UR' }, signature, 'not-a-key')
    expect(result).toEqual({ status: 'invalid', reason: 'public key could not be parsed' })
  })
})

describe('verifyAgentCard', () => {
  test('reports unsigned when no signatures are present', () => {
    expect(verifyAgentCard({ name: 'UR' }, () => key.publicKeyPem)).toEqual({ status: 'unsigned' })
    expect(verifyAgentCard({ name: 'UR', signatures: [] }, () => key.publicKeyPem)).toEqual({
      status: 'unsigned',
    })
  })

  test('accepts a card when one of several signatures verifies', () => {
    const other = generateAgentCardSigningKey()
    const card: Record<string, unknown> = { name: 'UR' }
    const signed = withAgentCardSignature(withAgentCardSignature(card, other), key)
    expect(signed.signatures).toHaveLength(2)
    expect(verifyAgentCard(signed, kid => (kid === key.kid ? key.publicKeyPem : undefined))).toEqual(
      { status: 'valid', kid: key.kid },
    )
  })

  test('reports when no key resolves for the advertised kid', () => {
    const signed = withAgentCardSignature({ name: 'UR' }, key)
    const result = verifyAgentCard(signed, () => undefined)
    expect(result.status).toBe('invalid')
    expect(result).toMatchObject({ reason: expect.stringContaining('no public key for kid') })
  })
})

describe('agentCardKeyId', () => {
  test('is stable for the same key and distinct across keys', () => {
    expect(agentCardKeyId(key.publicKeyPem)).toBe(key.kid)
    expect(agentCardKeyId(generateAgentCardSigningKey().publicKeyPem)).not.toBe(key.kid)
  })
})

describe('buildA2AV1AgentCard signing', () => {
  test('leaves signatures empty when no key is configured', () => {
    expect(buildA2AV1AgentCard({ baseUrl: 'https://agent.example' }).signatures).toEqual([])
  })

  test('signs a real card so a client can verify it end to end', () => {
    const options = { baseUrl: 'https://agent.example', signingKey: key }
    const card = buildA2AV1AgentCard(options)
    expect(card.signatures).toHaveLength(1)
    expect(verifyAgentCard(card, () => key.publicKeyPem)).toEqual({
      status: 'valid',
      kid: key.kid,
    })
  })

  test('detects a card whose endpoint was rewritten after signing', () => {
    const card = buildA2AV1AgentCard({ baseUrl: 'https://agent.example', signingKey: key })
    const tampered = {
      ...card,
      supportedInterfaces: card.supportedInterfaces.map(entry => ({
        ...entry,
        url: 'https://attacker.example',
      })),
    }
    expect(verifyAgentCard(tampered, () => key.publicKeyPem).status).toBe('invalid')
  })

  test('signing does not otherwise alter the card', () => {
    const base = buildA2AV1AgentCard({ baseUrl: 'https://agent.example' })
    const signed = buildA2AV1AgentCard({ baseUrl: 'https://agent.example', signingKey: key })
    expect({ ...signed, signatures: [] }).toEqual(base)
  })
})

function generateAgentCardSigningKeyRsa(): string {
  const { generateKeyPairSync } = require('node:crypto')
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}
