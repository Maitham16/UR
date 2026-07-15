import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto'
import { basename, join, relative, sep } from 'node:path'
import { getURConfigHomeDir, isEnvTruthy } from '../utils/envUtils.js'
import {
  FRONTMATTER_REGEX,
  parseFrontmatter,
  type FrontmatterData,
} from '../utils/frontmatterParser.js'
import { safeParseJSON } from '../utils/json.js'

export const SKILL_INTEGRITY_MANIFEST = '.ur-skill-integrity.json'
export const SKILL_PROVENANCE_SCHEMA_VERSION = 1

const MAX_SKILL_FILES = 10_000
const MAX_SKILL_FILE_BYTES = 64 * 1024 * 1024
const MAX_SKILL_TREE_BYTES = 256 * 1024 * 1024
const MAX_MANIFEST_BYTES = 64 * 1024
const SPEC_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const KEY_ID = /^[a-zA-Z0-9._-]{1,128}$/
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules'])

export type SkillValidationDiagnostic = {
  severity: 'error' | 'warning'
  code: string
  field?: string
  message: string
}

export type AgentSkillValidation = {
  valid: boolean
  diagnostics: SkillValidationDiagnostic[]
}

export type SkillPermissionSummary = {
  allowedTools: string[]
  hasHooks: boolean
  shell?: string
  executionContext?: string
  agent?: string
  modelInvocationDisabled: boolean
  userInvocable: boolean
}

export type SkillTreeEntry = {
  path: string
  type: 'file' | 'symlink'
  sha256: string
  bytes: number
  executable?: boolean
  target?: string
}

export type SkillTreeDigest = {
  algorithm: 'sha256'
  digest: string
  files: number
  bytes: number
  entries: SkillTreeEntry[]
  hasSymlinks: boolean
}

export type SkillSignatureStatus =
  | 'unsigned'
  | 'verified'
  | 'verified-untrusted'
  | 'invalid'
  | 'unknown-key'

export type SkillSignature = {
  status: SkillSignatureStatus
  keyId?: string
  signedAt?: string
  reason?: string
  manifestDigest?: string
}

export type SkillProvenance = {
  schemaVersion: 1
  format: 'agentskills.io'
  name: string
  source: string
  loadedFrom: string
  canonicalPath: string
  verifiedAt: string
  contentDigest: string
  tree: SkillTreeDigest
  permissionDigest: string
  permissions: SkillPermissionSummary
  validation: AgentSkillValidation
  signature: SkillSignature
}

export type SkillIntegrityManifest = {
  schemaVersion: 1
  algorithm: 'ed25519'
  keyId: string
  skillName: string
  treeDigest: string
  permissionDigest: string
  signature: string
  publicKey?: string
  signedAt: string
}

export type TrustedSkillKeys = Record<string, string>

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function permissionSummary(frontmatter: FrontmatterData): SkillPermissionSummary {
  const rawTools = frontmatter['allowed-tools']
  const allowedTools = Array.isArray(rawTools)
    ? rawTools.filter((item): item is string => typeof item === 'string')
    : typeof rawTools === 'string'
      ? rawTools
          .split(/[\s,]+/)
          .map(item => item.trim())
          .filter(Boolean)
      : []
  return {
    allowedTools: [...new Set(allowedTools)].sort(),
    hasHooks: Boolean(frontmatter.hooks),
    shell: stringValue(frontmatter.shell),
    executionContext: stringValue(frontmatter.context),
    agent: stringValue(frontmatter.agent),
    modelInvocationDisabled:
      String(frontmatter['disable-model-invocation'] ?? '').toLowerCase() ===
      'true',
    userInvocable:
      frontmatter['user-invocable'] === undefined ||
      String(frontmatter['user-invocable']).toLowerCase() !== 'false',
  }
}

function diagnostic(
  severity: SkillValidationDiagnostic['severity'],
  code: string,
  message: string,
  field?: string,
): SkillValidationDiagnostic {
  return { severity, code, message, ...(field ? { field } : {}) }
}

/** Strict validator for the current agentskills.io SKILL.md frontmatter. */
export function validateAgentSkill(
  rawSkill: string,
  directoryName: string,
): AgentSkillValidation {
  const diagnostics: SkillValidationDiagnostic[] = []
  if (!FRONTMATTER_REGEX.test(rawSkill)) {
    diagnostics.push(
      diagnostic(
        'error',
        'frontmatter.missing',
        'SKILL.md must begin with YAML frontmatter',
      ),
    )
  }
  const { frontmatter, content } = parseFrontmatter(rawSkill)
  const name = frontmatter.name
  if (typeof name !== 'string' || name.length === 0) {
    diagnostics.push(
      diagnostic('error', 'name.required', 'name is required', 'name'),
    )
  } else {
    if (name.length > 64 || !SPEC_NAME.test(name)) {
      diagnostics.push(
        diagnostic(
          'error',
          'name.format',
          'name must be 1-64 lowercase letters, digits, or single hyphens',
          'name',
        ),
      )
    }
    if (name !== directoryName) {
      diagnostics.push(
        diagnostic(
          'error',
          'name.directory_mismatch',
          `name must match its parent directory "${directoryName}"`,
          'name',
        ),
      )
    }
  }

  const description = frontmatter.description
  if (typeof description !== 'string' || description.length === 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'description.required',
        'description is required',
        'description',
      ),
    )
  } else if (description.length > 1024) {
    diagnostics.push(
      diagnostic(
        'error',
        'description.length',
        'description must not exceed 1024 characters',
        'description',
      ),
    )
  }

  if (
    frontmatter.compatibility !== undefined &&
    (typeof frontmatter.compatibility !== 'string' ||
      frontmatter.compatibility.length > 500)
  ) {
    diagnostics.push(
      diagnostic(
        'error',
        'compatibility.format',
        'compatibility must be a string of at most 500 characters',
        'compatibility',
      ),
    )
  }
  if (
    frontmatter.license !== undefined &&
    typeof frontmatter.license !== 'string'
  ) {
    diagnostics.push(
      diagnostic('error', 'license.format', 'license must be a string', 'license'),
    )
  }
  if (frontmatter.metadata !== undefined) {
    if (
      !frontmatter.metadata ||
      typeof frontmatter.metadata !== 'object' ||
      Array.isArray(frontmatter.metadata)
    ) {
      diagnostics.push(
        diagnostic(
          'error',
          'metadata.format',
          'metadata must be a string-to-string mapping',
          'metadata',
        ),
      )
    } else if (
      Object.values(frontmatter.metadata as Record<string, unknown>).some(
        value => typeof value !== 'string',
      )
    ) {
      diagnostics.push(
        diagnostic(
          'error',
          'metadata.values',
          'all metadata values must be strings',
          'metadata',
        ),
      )
    }
  }
  if (
    frontmatter['allowed-tools'] !== undefined &&
    typeof frontmatter['allowed-tools'] !== 'string'
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'allowed-tools.experimental_format',
        'agentskills.io defines allowed-tools as a space-delimited string',
        'allowed-tools',
      ),
    )
  }
  if (content.trim().length === 0) {
    diagnostics.push(
      diagnostic(
        'warning',
        'instructions.empty',
        'SKILL.md has no instruction body',
      ),
    )
  }

  return {
    valid: !diagnostics.some(item => item.severity === 'error'),
    diagnostics,
  }
}

function normalizedPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

export function computeSkillTree(skillDir: string): SkillTreeDigest {
  const root = realpathSync(skillDir)
  const entries: SkillTreeEntry[] = []
  let totalBytes = 0

  function visit(dir: string): void {
    const children = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const child of children) {
      if (child.name === SKILL_INTEGRITY_MANIFEST) continue
      if (child.isDirectory() && EXCLUDED_DIRECTORIES.has(child.name)) continue
      const path = join(dir, child.name)
      const relativePath = normalizedPath(root, path)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(path)
        const targetBytes = Buffer.byteLength(target)
        if (entries.length >= MAX_SKILL_FILES) {
          throw new Error('Skill directory exceeds the 10,000-file integrity limit')
        }
        totalBytes += targetBytes
        if (totalBytes > MAX_SKILL_TREE_BYTES) {
          throw new Error('Skill directory exceeds the 256 MiB integrity limit')
        }
        entries.push({
          path: relativePath,
          type: 'symlink',
          sha256: sha256(target),
          bytes: targetBytes,
          target,
        })
        continue
      }
      if (stat.isDirectory()) {
        visit(path)
        continue
      }
      if (!stat.isFile()) continue
      if (stat.size > MAX_SKILL_FILE_BYTES) {
        throw new Error(`Skill file exceeds 64 MiB: ${relativePath}`)
      }
      totalBytes += stat.size
      if (totalBytes > MAX_SKILL_TREE_BYTES) {
        throw new Error('Skill directory exceeds the 256 MiB integrity limit')
      }
      if (entries.length >= MAX_SKILL_FILES) {
        throw new Error('Skill directory exceeds the 10,000-file integrity limit')
      }
      const body = readFileSync(path)
      entries.push({
        path: relativePath,
        type: 'file',
        sha256: sha256(body),
        bytes: stat.size,
        ...(stat.mode & 0o111 ? { executable: true } : {}),
      })
    }
  }

  visit(root)
  entries.sort((a, b) => a.path.localeCompare(b.path))
  const canonical = entries
    .map(entry =>
      stableJson({
        path: entry.path,
        type: entry.type,
        sha256: entry.sha256,
        bytes: entry.bytes,
        executable: entry.executable === true,
        target: entry.target ?? null,
      }),
    )
    .join('\n')
  return {
    algorithm: 'sha256',
    digest: sha256(`ur-skill-tree-v1\n${canonical}\n`),
    files: entries.length,
    bytes: totalBytes,
    entries,
    hasSymlinks: entries.some(entry => entry.type === 'symlink'),
  }
}

function canonicalSignaturePayload(input: {
  keyId: string
  skillName: string
  treeDigest: string
  permissionDigest: string
}): Buffer {
  return Buffer.from(
    stableJson({
      schemaVersion: SKILL_PROVENANCE_SCHEMA_VERSION,
      algorithm: 'ed25519',
      keyId: input.keyId,
      skillName: input.skillName,
      treeDigest: input.treeDigest,
      permissionDigest: input.permissionDigest,
    }),
    'utf8',
  )
}

function keyFingerprint(key: string | KeyObject): string {
  const der = createPublicKey(key).export({ type: 'spki', format: 'der' })
  return sha256(der)
}

export function trustedSkillKeysPath(): string {
  return (
    process.env.UR_SKILL_TRUSTED_KEYS_FILE ??
    join(getURConfigHomeDir(), 'trusted-skill-keys.json')
  )
}

export function loadTrustedSkillKeys(path = trustedSkillKeysPath()): TrustedSkillKeys {
  if (!existsSync(path)) return {}
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) {
    throw new Error('Trusted skill key store must be a regular file under 64 KiB')
  }
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) {
    throw new Error('Trusted skill key store must not be group- or world-writable')
  }
  const parsed = safeParseJSON(readFileSync(path, 'utf8'), false)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Trusted skill key store must be a JSON object')
  }
  const keys: TrustedSkillKeys = {}
  for (const [keyId, value] of Object.entries(parsed)) {
    if (!KEY_ID.test(keyId) || typeof value !== 'string') {
      throw new Error('Trusted skill key store contains an invalid key entry')
    }
    createPublicKey(value)
    keys[keyId] = value
  }
  return keys
}

function readIntegrityManifest(skillDir: string): {
  manifest?: SkillIntegrityManifest
  digest?: string
  error?: string
} {
  const path = join(skillDir, SKILL_INTEGRITY_MANIFEST)
  if (!existsSync(path)) return {}
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) {
      return { error: 'integrity manifest is not a bounded regular file' }
    }
    const raw = readFileSync(path)
    const parsed = safeParseJSON(raw.toString('utf8'), false) as
      | Partial<SkillIntegrityManifest>
      | null
    if (
      !parsed ||
      parsed.schemaVersion !== 1 ||
      parsed.algorithm !== 'ed25519' ||
      typeof parsed.keyId !== 'string' ||
      !KEY_ID.test(parsed.keyId) ||
      typeof parsed.skillName !== 'string' ||
      typeof parsed.treeDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(parsed.treeDigest) ||
      typeof parsed.permissionDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(parsed.permissionDigest) ||
      typeof parsed.signature !== 'string' ||
      typeof parsed.signedAt !== 'string'
    ) {
      return { error: 'integrity manifest schema is invalid' }
    }
    return {
      manifest: parsed as SkillIntegrityManifest,
      digest: sha256(raw),
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function verifyManifest(
  skillDir: string,
  name: string,
  tree: SkillTreeDigest,
  permissionDigest: string,
  trustedKeys: TrustedSkillKeys,
): SkillSignature {
  const loaded = readIntegrityManifest(skillDir)
  if (!loaded.manifest) {
    return loaded.error
      ? { status: 'invalid', reason: loaded.error }
      : { status: 'unsigned' }
  }
  const manifest = loaded.manifest
  const base = {
    keyId: manifest.keyId,
    signedAt: manifest.signedAt,
    manifestDigest: loaded.digest,
  }
  if (
    manifest.skillName !== name ||
    manifest.treeDigest !== tree.digest ||
    manifest.permissionDigest !== permissionDigest
  ) {
    return { status: 'invalid', ...base, reason: 'signed digests do not match' }
  }
  if (tree.hasSymlinks) {
    return { status: 'invalid', ...base, reason: 'signed skills cannot contain symlinks' }
  }

  const trustedKey = trustedKeys[manifest.keyId]
  const candidate = trustedKey ?? manifest.publicKey
  if (!candidate) {
    return { status: 'unknown-key', ...base, reason: 'public key is unavailable' }
  }
  try {
    if (
      trustedKey &&
      manifest.publicKey &&
      keyFingerprint(trustedKey) !== keyFingerprint(manifest.publicKey)
    ) {
      return { status: 'invalid', ...base, reason: 'embedded key conflicts with trusted key' }
    }
    const signature = Buffer.from(manifest.signature, 'base64')
    if (signature.length !== 64) {
      return { status: 'invalid', ...base, reason: 'Ed25519 signature length is invalid' }
    }
    const valid = verify(
      null,
      canonicalSignaturePayload(manifest),
      createPublicKey(candidate),
      signature,
    )
    if (!valid) return { status: 'invalid', ...base, reason: 'signature verification failed' }
    return { status: trustedKey ? 'verified' : 'verified-untrusted', ...base }
  } catch (error) {
    return {
      status: 'invalid',
      ...base,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export function inspectSkillProvenance(options: {
  skillDir: string
  rawSkill?: string
  source: string
  loadedFrom: string
  trustedKeys?: TrustedSkillKeys
}): SkillProvenance {
  const canonicalPath = realpathSync(options.skillDir)
  const rawSkill =
    options.rawSkill ?? readFileSync(join(canonicalPath, 'SKILL.md'), 'utf8')
  const { frontmatter } = parseFrontmatter(rawSkill, join(canonicalPath, 'SKILL.md'))
  const name =
    typeof frontmatter.name === 'string' ? frontmatter.name : basename(canonicalPath)
  const permissions = permissionSummary(frontmatter)
  const permissionDigest = sha256(stableJson(permissions))
  const tree = computeSkillTree(canonicalPath)
  let trustedKeys = options.trustedKeys
  if (!trustedKeys) {
    try {
      trustedKeys = loadTrustedSkillKeys()
    } catch {
      trustedKeys = {}
    }
  }
  return {
    schemaVersion: 1,
    format: 'agentskills.io',
    name,
    source: options.source,
    loadedFrom: options.loadedFrom,
    canonicalPath,
    verifiedAt: new Date().toISOString(),
    contentDigest: sha256(rawSkill),
    tree,
    permissionDigest,
    permissions,
    validation: validateAgentSkill(rawSkill, basename(canonicalPath)),
    signature: verifyManifest(
      canonicalPath,
      name,
      tree,
      permissionDigest,
      trustedKeys,
    ),
  }
}

export function signSkillDirectory(options: {
  skillDir: string
  keyId: string
  privateKey: string | Buffer
  signedAt?: string
}): SkillProvenance {
  if (!KEY_ID.test(options.keyId)) {
    throw new Error('keyId must be 1-128 letters, digits, dot, underscore, or hyphen')
  }
  const inspected = inspectSkillProvenance({
    skillDir: options.skillDir,
    source: 'signing',
    loadedFrom: 'local',
    trustedKeys: {},
  })
  if (!inspected.validation.valid) {
    throw new Error(
      `Cannot sign a spec-invalid skill: ${inspected.validation.diagnostics
        .filter(item => item.severity === 'error')
        .map(item => item.message)
        .join('; ')}`,
    )
  }
  if (inspected.tree.hasSymlinks) {
    throw new Error('Cannot sign a skill directory containing symlinks')
  }
  const privateKey = createPrivateKey(options.privateKey)
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Skill signing requires an Ed25519 private key')
  }
  const publicKey = createPublicKey(privateKey).export({
    type: 'spki',
    format: 'pem',
  }) as string
  const manifest: SkillIntegrityManifest = {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId: options.keyId,
    skillName: inspected.name,
    treeDigest: inspected.tree.digest,
    permissionDigest: inspected.permissionDigest,
    signature: sign(
      null,
      canonicalSignaturePayload({
        keyId: options.keyId,
        skillName: inspected.name,
        treeDigest: inspected.tree.digest,
        permissionDigest: inspected.permissionDigest,
      }),
      privateKey,
    ).toString('base64'),
    publicKey,
    signedAt: options.signedAt ?? new Date().toISOString(),
  }
  const path = join(inspected.canonicalPath, SKILL_INTEGRITY_MANIFEST)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    try {
      unlinkSync(temporary)
    } catch {
      // Already atomically renamed or never created.
    }
  }
  return inspectSkillProvenance({
    skillDir: inspected.canonicalPath,
    source: 'signing',
    loadedFrom: 'local',
    trustedKeys: { [options.keyId]: publicKey },
  })
}

export function assertSkillIntegrity(provenance: SkillProvenance): void {
  const currentTree = computeSkillTree(provenance.canonicalPath)
  if (currentTree.digest !== provenance.tree.digest) {
    throw new Error(
      `Skill integrity changed after load: ${provenance.name}. Reload skills before invoking it.`,
    )
  }
  if (provenance.signature.manifestDigest) {
    const manifest = readIntegrityManifest(provenance.canonicalPath)
    if (manifest.digest !== provenance.signature.manifestDigest) {
      throw new Error(`Skill signature manifest changed after load: ${provenance.name}`)
    }
  }
}

export function shouldEnforceStrictSkillSpec(): boolean {
  return isEnvTruthy(process.env.UR_SKILLS_STRICT_SPEC)
}

export function shouldRequireTrustedSkillSignature(): boolean {
  return isEnvTruthy(process.env.UR_SKILLS_REQUIRE_TRUSTED_SIGNATURE)
}
