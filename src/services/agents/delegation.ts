import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

/**
 * A2A delegation (capability) tokens.
 *
 * A minimal, dependency-free capability token for agent-to-agent delegation:
 * an HMAC-signed payload that is scoped to specific skills, bound to one
 * audience (the agent it is for), and time-limited. Unlike a static shared
 * secret, a delegation token can be attenuated — a holder can mint a strictly
 * narrower child token (subset of scopes, no later expiry) to hand onward.
 * This is the local-first building block for "agent identity & delegated
 * authorization" without turning UR into an identity provider: keys and
 * verification stay on the machine that runs the A2A adapter.
 *
 * Format: `base64url(JSON claims) + "." + base64url(HMAC-SHA256(payload))`.
 */

export type DelegationClaims = {
  /** Token format version. */
  v: 1
  /** Delegator / issuer identity. */
  sub: string
  /** Intended audience — the agent id this token is valid for. */
  aud: string
  /** Allowed skill ids, or ['*'] for every skill. */
  scope: string[]
  /** Issued-at, epoch seconds. */
  iat: number
  /** Expiry, epoch seconds. */
  exp: number
  /** Unique token id (nonce). */
  jti: string
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeJson(encoded: string): unknown {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function normalizeScope(scope?: string[]): string[] {
  if (!scope || scope.length === 0) return ['*']
  return scope.includes('*') ? ['*'] : [...new Set(scope)]
}

/** True when `scope` authorizes a given skill id. */
export function scopeAllows(scope: string[], skill: string): boolean {
  return scope.includes('*') || scope.includes(skill)
}

/** True when `child` grants no more than `parent` (attenuation invariant). */
export function isScopeSubset(child: string[], parent: string[]): boolean {
  if (parent.includes('*')) return true
  if (child.includes('*')) return false
  return child.every(skill => parent.includes(skill))
}

export type MintOptions = {
  subject: string
  audience: string
  scope?: string[]
  ttlSeconds?: number
  /** Override the clock (epoch seconds) — for deterministic tests. */
  now?: number
  jti?: string
}

export function mintDelegationToken(secret: string, options: MintOptions): string {
  if (!secret) throw new Error('a delegation secret is required')
  const issued = options.now ?? nowSeconds()
  const ttl = options.ttlSeconds ?? 3600
  const claims: DelegationClaims = {
    v: 1,
    sub: options.subject,
    aud: options.audience,
    scope: normalizeScope(options.scope),
    iat: issued,
    exp: issued + Math.max(1, Math.floor(ttl)),
    jti: options.jti ?? randomUUID(),
  }
  const payload = encodeJson(claims)
  return `${payload}.${sign(secret, payload)}`
}

export type VerifyOptions = {
  /** Reject the token unless its audience matches this agent id. */
  audience?: string
  /** Reject the token unless its scope authorizes this skill. */
  requiredScope?: string
  now?: number
}

export type VerifyResult = {
  valid: boolean
  reason?: string
  claims?: DelegationClaims
}

export function verifyDelegationToken(
  secret: string,
  token: string,
  options: VerifyOptions = {},
): VerifyResult {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed token' }
  }
  const [payload, signature] = parts
  if (!constantTimeEqual(signature, sign(secret, payload))) {
    return { valid: false, reason: 'bad signature' }
  }
  let claims: DelegationClaims
  try {
    claims = decodeJson(payload) as DelegationClaims
  } catch {
    return { valid: false, reason: 'unparseable payload' }
  }
  if (!claims || claims.v !== 1 || !Array.isArray(claims.scope)) {
    return { valid: false, reason: 'unsupported token version' }
  }
  const now = options.now ?? nowSeconds()
  if (typeof claims.exp !== 'number' || now >= claims.exp) {
    return { valid: false, reason: 'token expired', claims }
  }
  if (options.audience && claims.aud !== options.audience) {
    return {
      valid: false,
      reason: `audience mismatch (token issued for "${claims.aud}")`,
      claims,
    }
  }
  if (options.requiredScope && !scopeAllows(claims.scope, options.requiredScope)) {
    return {
      valid: false,
      reason: `scope "${options.requiredScope}" not granted`,
      claims,
    }
  }
  return { valid: true, claims }
}

export type AttenuateOptions = {
  /** Narrower scope; defaults to the parent's scope. Must be a subset. */
  scope?: string[]
  /** Shorter TTL; clamped so the child never outlives the parent. */
  ttlSeconds?: number
  /** Override the delegator identity on the child (defaults to the parent's). */
  subject?: string
  now?: number
}

export type AttenuateResult = { token?: string; error?: string }

/** Derive a strictly narrower child token from a parent's claims. */
export function attenuateDelegationToken(
  secret: string,
  parent: DelegationClaims,
  options: AttenuateOptions = {},
): AttenuateResult {
  const now = options.now ?? nowSeconds()
  const requested = options.scope ? normalizeScope(options.scope) : parent.scope
  if (!isScopeSubset(requested, parent.scope)) {
    return { error: 'attenuated scope must be a subset of the parent scope' }
  }
  const remaining = parent.exp - now
  if (remaining <= 0) return { error: 'parent token has already expired' }
  const ttl =
    options.ttlSeconds != null ? Math.min(options.ttlSeconds, remaining) : remaining
  if (ttl <= 0) return { error: 'attenuated token would already be expired' }
  const token = mintDelegationToken(secret, {
    subject: options.subject ?? parent.sub,
    audience: parent.aud,
    scope: requested,
    ttlSeconds: ttl,
    now,
  })
  return { token }
}

export function describeClaims(claims: DelegationClaims): string {
  const expiresIn = Math.max(0, claims.exp - nowSeconds())
  return [
    `subject:  ${claims.sub}`,
    `audience: ${claims.aud}`,
    `scope:    ${claims.scope.join(', ')}`,
    `expires:  ${new Date(claims.exp * 1000).toISOString()} (in ${expiresIn}s)`,
    `id:       ${claims.jti}`,
  ].join('\n')
}
