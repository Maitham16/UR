import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'

/**
 * A2A delegation (capability) tokens.
 *
 * A minimal, dependency-free capability token for agent-to-agent delegation:
 * an HMAC-signed payload that is scoped to specific skills, bound to one
 * audience (the agent it is for), and time-limited. Unlike a static shared
 * secret, an issuer can mint short-lived tokens with narrow scopes. The
 * `attenuateDelegationToken` helper is deliberately issuer-side: HMAC tokens
 * cannot be safely re-signed by an untrusted holder without also giving that
 * holder the root secret and the ability to mint broader tokens.
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

export function constantTimeStringEqual(a: string, b: string): boolean {
  // Hash first so timingSafeEqual always receives fixed-size inputs. This is
  // also safe for variable-length static bearer tokens; an early length check
  // would otherwise make comparisons observably different.
  const left = createHash('sha256').update(a, 'utf8').digest()
  const right = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(left, right)
}

export function normalizeScope(scope?: string[]): string[] {
  if (!scope || scope.length === 0) return ['*']
  if (scope.length > 64) throw new Error('delegation scope has too many entries')
  const normalized = scope.map(value => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 128 ||
      value.includes('\0')
    ) {
      throw new Error('delegation scopes must be non-empty strings up to 128 characters')
    }
    return value.trim()
  })
  return normalized.includes('*') ? ['*'] : [...new Set(normalized)]
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

const MAX_TOKEN_CHARS = 16 * 1024
const MAX_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60
const MAX_CLOCK_SKEW_SECONDS = 60

function validClaimString(value: unknown, maxLength = 256): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !value.includes('\0')
  )
}

export function mintDelegationToken(secret: string, options: MintOptions): string {
  if (!secret) throw new Error('a delegation secret is required')
  if (!validClaimString(options.subject)) {
    throw new Error('delegation subject must be 1-256 characters without NUL bytes')
  }
  if (!validClaimString(options.audience)) {
    throw new Error('delegation audience must be 1-256 characters without NUL bytes')
  }
  const issued = options.now ?? nowSeconds()
  const ttl = options.ttlSeconds ?? 3600
  if (!Number.isSafeInteger(issued) || issued < 0) {
    throw new Error('delegation issued-at time must be a non-negative integer')
  }
  if (
    !Number.isFinite(ttl) ||
    ttl <= 0 ||
    ttl > MAX_TOKEN_LIFETIME_SECONDS
  ) {
    throw new Error(
      `delegation lifetime must be between 1 and ${MAX_TOKEN_LIFETIME_SECONDS} seconds`,
    )
  }
  const expires = issued + Math.max(1, Math.floor(ttl))
  if (!Number.isSafeInteger(expires)) {
    throw new Error('delegation expiry exceeds the safe integer range')
  }
  const jti = options.jti ?? randomUUID()
  if (!validClaimString(jti)) {
    throw new Error('delegation token id must be 1-256 characters without NUL bytes')
  }
  const claims: DelegationClaims = {
    v: 1,
    sub: options.subject,
    aud: options.audience,
    scope: normalizeScope(options.scope),
    iat: issued,
    exp: expires,
    jti,
  }
  const payload = encodeJson(claims)
  return `${payload}.${sign(secret, payload)}`
}

export type VerifyOptions = {
  /** Reject the token unless its audience matches this agent id. */
  audience?: string
  /** Additional accepted audience ids for compatibility migrations. */
  audienceAliases?: string[]
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
  if (!secret || !token || token.length > MAX_TOKEN_CHARS) {
    return { valid: false, reason: 'malformed token' }
  }
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed token' }
  }
  const [payload, signature] = parts
  if (!constantTimeStringEqual(signature, sign(secret, payload))) {
    return { valid: false, reason: 'bad signature' }
  }
  let claims: DelegationClaims
  try {
    claims = decodeJson(payload) as DelegationClaims
  } catch {
    return { valid: false, reason: 'unparseable payload' }
  }
  if (
    !claims ||
    typeof claims !== 'object' ||
    claims.v !== 1 ||
    !validClaimString(claims.sub) ||
    !validClaimString(claims.aud) ||
    !validClaimString(claims.jti) ||
    !Array.isArray(claims.scope) ||
    claims.scope.length === 0 ||
    claims.scope.length > 64 ||
    !claims.scope.every(scope => validClaimString(scope, 128)) ||
    (claims.scope.includes('*') && claims.scope.length !== 1) ||
    !Number.isSafeInteger(claims.iat) ||
    claims.iat < 0 ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS
  ) {
    return { valid: false, reason: 'invalid token claims' }
  }
  const now = options.now ?? nowSeconds()
  if (!Number.isSafeInteger(now) || now < 0) {
    return { valid: false, reason: 'invalid verification clock' }
  }
  if (claims.iat > now + MAX_CLOCK_SKEW_SECONDS) {
    return { valid: false, reason: 'token issued in the future', claims }
  }
  if (typeof claims.exp !== 'number' || now >= claims.exp) {
    return { valid: false, reason: 'token expired', claims }
  }
  const acceptedAudiences = options.audience
    ? [options.audience, ...(options.audienceAliases ?? [])]
    : []
  if (acceptedAudiences.length > 0 && !acceptedAudiences.includes(claims.aud)) {
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

/**
 * Issuer-side helper for deriving a no-broader token from verified parent
 * claims. This requires the root signing secret; it is not holder attenuation.
 */
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
