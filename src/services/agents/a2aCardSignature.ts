import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto'

/**
 * Signed A2A Agent Cards (RFC 7515 detached JWS).
 *
 * An Agent Card is discovery metadata served over plain HTTP, so a client has
 * no way to tell a genuine card from one injected by whatever sits between it
 * and the agent. A2A v1 answers that with `signatures`: detached JWS values
 * computed over the card itself, letting a client verify which key vouched for
 * the card before it trusts the skills, endpoints, or auth schemes advertised
 * inside it.
 *
 * Detached means the JWS carries no payload of its own — the card *is* the
 * payload. Signing input is `base64url(protected) + "." + base64url(payload)`,
 * where payload is the card with `signatures` removed and serialized
 * canonically (RFC 8785). Canonical form matters because the verifier
 * re-serializes a parsed card: without a fixed key order, an identical card
 * would produce a different payload and fail verification.
 *
 * Ed25519 (`alg: "EdDSA"`) is the only algorithm accepted. It needs no curve
 * or hash negotiation, and refusing to honor a caller-supplied `alg` closes
 * the algorithm-substitution class of JWS attacks.
 */

export const A2A_CARD_SIGNATURE_ALG = 'EdDSA'

export type A2AAgentCardSignature = {
  /** Base64url-encoded protected JWS header. */
  protected: string
  /** Base64url-encoded Ed25519 signature. */
  signature: string
  /** Unprotected header values. Not covered by the signature. */
  header?: Record<string, unknown>
}

export type A2ASignableCard = Record<string, unknown> & {
  signatures?: unknown
}

export type A2ACardSigningKey = {
  /** PKCS#8 PEM Ed25519 private key. */
  privateKeyPem: string
  /** Key id published in the protected header so verifiers can select a key. */
  kid?: string
}

export type A2ACardVerifyResult =
  | { status: 'valid'; kid?: string }
  | { status: 'unsigned' }
  | { status: 'invalid'; reason: string }

function base64url(value: Buffer | string): string {
  return (typeof value === 'string' ? Buffer.from(value, 'utf8') : value).toString('base64url')
}

/**
 * RFC 8785 canonical JSON: object keys sorted by UTF-16 code unit, no
 * insignificant whitespace. Non-finite numbers and undefined are rejected
 * rather than coerced, because JSON.stringify would silently turn them into
 * `null` or drop the key and change what actually got signed.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) return 'null'

  if (typeof value === 'boolean') return value ? 'true' : 'false'

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('cannot canonicalize a non-finite number')
    }
    return JSON.stringify(value)
  }

  if (typeof value === 'string') return JSON.stringify(value)

  if (Array.isArray(value)) {
    return `[${value.map(entry => canonicalizeJson(entry === undefined ? null : entry)).join(',')}]`
  }

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const keys = Object.keys(source)
      .filter(key => source[key] !== undefined)
      .sort()
    const members = keys.map(key => `${JSON.stringify(key)}:${canonicalizeJson(source[key])}`)
    return `{${members.join(',')}}`
  }

  throw new Error(`cannot canonicalize value of type ${typeof value}`)
}

/** Strip `signatures` so a card signs the same bytes before and after signing. */
function signingPayload(card: A2ASignableCard): string {
  const { signatures: _signatures, ...rest } = card
  return base64url(canonicalizeJson(rest))
}

/**
 * Stable key id: base64url SHA-256 over the SPKI DER of the public key. Two
 * deployments holding the same key derive the same kid without coordinating.
 */
export function agentCardKeyId(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('base64url')
}

/** Generate an Ed25519 keypair for signing Agent Cards. */
export function generateAgentCardSigningKey(): {
  privateKeyPem: string
  publicKeyPem: string
  kid: string
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return { privateKeyPem, publicKeyPem, kid: agentCardKeyId(publicKeyPem) }
}

/**
 * Sign a card, returning the detached JWS to append to `card.signatures`.
 * Any existing `signatures` entries are excluded from the payload, so several
 * keys can sign the same card independently.
 */
export function signAgentCard(
  card: A2ASignableCard,
  key: A2ACardSigningKey,
): A2AAgentCardSignature {
  const privateKey = createPrivateKey(key.privateKeyPem)
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Agent Card signing requires an Ed25519 private key')
  }

  const header: Record<string, unknown> = { alg: A2A_CARD_SIGNATURE_ALG }
  if (key.kid) header.kid = key.kid

  const protectedHeader = base64url(canonicalizeJson(header))
  const signingInput = `${protectedHeader}.${signingPayload(card)}`
  const signature = cryptoSign(null, Buffer.from(signingInput, 'utf8'), privateKey)

  return { protected: protectedHeader, signature: signature.toString('base64url') }
}

/** Sign a card and return a copy carrying the signature. */
export function withAgentCardSignature<T extends A2ASignableCard>(
  card: T,
  key: A2ACardSigningKey,
): T & { signatures: A2AAgentCardSignature[] } {
  const existing = Array.isArray(card.signatures)
    ? (card.signatures as A2AAgentCardSignature[])
    : []
  return { ...card, signatures: [...existing, signAgentCard(card, key)] }
}

function parseProtectedHeader(encoded: string): Record<string, unknown> | undefined {
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(decoded)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Verify one detached JWS against a card.
 *
 * The protected header is used verbatim from the signature rather than
 * re-encoded: base64url of JSON is not unique, so re-deriving it would reject
 * signatures whose header bytes are valid but ordered differently.
 */
export function verifyAgentCardSignature(
  card: A2ASignableCard,
  signature: A2AAgentCardSignature,
  publicKeyPem: string,
): A2ACardVerifyResult {
  if (typeof signature?.protected !== 'string' || typeof signature?.signature !== 'string') {
    return { status: 'invalid', reason: 'signature is missing protected header or signature' }
  }

  const header = parseProtectedHeader(signature.protected)
  if (!header) {
    return { status: 'invalid', reason: 'protected header is not base64url-encoded JSON' }
  }
  if (header.alg !== A2A_CARD_SIGNATURE_ALG) {
    return { status: 'invalid', reason: `unsupported signature algorithm: ${String(header.alg)}` }
  }

  let publicKey
  try {
    publicKey = createPublicKey(publicKeyPem)
  } catch {
    return { status: 'invalid', reason: 'public key could not be parsed' }
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    return { status: 'invalid', reason: 'public key is not an Ed25519 key' }
  }

  const signingInput = `${signature.protected}.${signingPayload(card)}`
  let ok = false
  try {
    ok = cryptoVerify(
      null,
      Buffer.from(signingInput, 'utf8'),
      publicKey,
      Buffer.from(signature.signature, 'base64url'),
    )
  } catch {
    return { status: 'invalid', reason: 'signature bytes are malformed' }
  }

  if (!ok) return { status: 'invalid', reason: 'signature does not match the card' }
  return { status: 'valid', kid: typeof header.kid === 'string' ? header.kid : undefined }
}

/**
 * Verify a card that may carry several signatures. Succeeds when at least one
 * signature verifies against a key the caller can resolve. A card with no
 * signatures reports `unsigned` so callers can apply their own policy instead
 * of mistaking absent proof for a failed check.
 */
export function verifyAgentCard(
  card: A2ASignableCard,
  resolvePublicKey: (kid: string | undefined) => string | undefined,
): A2ACardVerifyResult {
  const signatures = Array.isArray(card.signatures)
    ? (card.signatures as A2AAgentCardSignature[])
    : []
  if (signatures.length === 0) return { status: 'unsigned' }

  const failures: string[] = []
  for (const signature of signatures) {
    const header = parseProtectedHeader(
      typeof signature?.protected === 'string' ? signature.protected : '',
    )
    const kid = typeof header?.kid === 'string' ? header.kid : undefined
    const publicKeyPem = resolvePublicKey(kid)
    if (!publicKeyPem) {
      failures.push(`no public key for kid ${kid ?? '(none)'}`)
      continue
    }
    const result = verifyAgentCardSignature(card, signature, publicKeyPem)
    if (result.status === 'valid') return result
    if (result.status === 'invalid') failures.push(result.reason)
  }

  return { status: 'invalid', reason: failures.join('; ') || 'no signature could be verified' }
}
