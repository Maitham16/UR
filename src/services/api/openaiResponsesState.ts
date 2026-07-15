import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { join, resolve } from 'node:path'
import { lockSync } from '../../utils/lockfile.js'

export type OpenAIResponseStateStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete'

export type OpenAIResponseStateMode = 'http' | 'background' | 'websocket'

export type OpenAIResponseState = {
  id: string
  status: OpenAIResponseStateStatus
  model: string
  mode: OpenAIResponseStateMode
  cursor?: number
  previousResponseId?: string
  createdAt: string
  updatedAt: string
}

type EncryptedWindow = {
  algorithm: 'aes-256-gcm'
  iv: string
  tag: string
  ciphertext: string
}

type PersistedState = OpenAIResponseState & {
  compactedWindow?: EncryptedWindow
}

type StateManifest = {
  version: 1
  responses: PersistedState[]
}

export type OpenAIResponsesStateStoreOptions = {
  cwd?: string
  directory?: string
  encryptionKey?: string | Uint8Array
  maxEntries?: number
}

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_WINDOW_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 1_000
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/u
const MODEL_RE = /^[^\0\r\n]{1,300}$/u
const STATUSES = new Set<OpenAIResponseStateStatus>([
  'queued',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
])
const MODES = new Set<OpenAIResponseStateMode>(['http', 'background', 'websocket'])
const lockWaitArray = new Int32Array(new SharedArrayBuffer(4))

function stateDirectory(options: OpenAIResponsesStateStoreOptions): string {
  return resolve(options.directory ?? join(options.cwd ?? process.cwd(), '.ur', 'openai-responses'))
}

function validateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`Refusing to use symlinked OpenAI Responses state directory: ${path}`)
  }
}

function ensurePrivateFile(path: string): void {
  if (!existsSync(path)) return
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Refusing unsafe OpenAI Responses state path: ${path}`)
  }
}

function acquireLock(path: string): () => void {
  let lastError: unknown
  for (let attempt = 0; attempt < 21; attempt++) {
    try {
      return lockSync(path, { realpath: false, stale: 30_000 })
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED' || attempt === 20) {
        throw error
      }
      Atomics.wait(lockWaitArray, 0, 0, Math.min(100, 10 + attempt * 5))
    }
  }
  throw lastError
}

function parseKey(value: string | Uint8Array | undefined): Buffer | undefined {
  if (value === undefined) return undefined
  if (value instanceof Uint8Array) {
    if (value.byteLength !== 32) {
      throw new Error('OpenAI Responses state encryption key must be exactly 32 bytes')
    }
    return Buffer.from(value)
  }
  const trimmed = value.trim()
  let decoded: Buffer
  if (/^[0-9a-fA-F]{64}$/u.test(trimmed)) {
    decoded = Buffer.from(trimmed, 'hex')
  } else {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
      throw new Error('OpenAI Responses state encryption key must be 64 hex characters or base64')
    }
    decoded = Buffer.from(normalized, 'base64')
  }
  if (decoded.byteLength !== 32) {
    throw new Error('OpenAI Responses state encryption key must decode to exactly 32 bytes')
  }
  return decoded
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function normalizeState(value: unknown): PersistedState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const state = value as Partial<PersistedState>
  if (
    !ID_RE.test(state.id ?? '') ||
    !MODEL_RE.test(state.model ?? '') ||
    !STATUSES.has(state.status as OpenAIResponseStateStatus) ||
    !MODES.has(state.mode as OpenAIResponseStateMode) ||
    !validDate(state.createdAt) ||
    !validDate(state.updatedAt) ||
    (state.cursor !== undefined && (!Number.isSafeInteger(state.cursor) || state.cursor < 0)) ||
    (state.previousResponseId !== undefined && !ID_RE.test(state.previousResponseId))
  ) {
    return null
  }
  let compactedWindow: EncryptedWindow | undefined
  const encrypted = state.compactedWindow
  if (
    encrypted?.algorithm === 'aes-256-gcm' &&
    typeof encrypted.iv === 'string' &&
    typeof encrypted.tag === 'string' &&
    typeof encrypted.ciphertext === 'string' &&
    encrypted.iv.length <= 64 &&
    encrypted.tag.length <= 64 &&
    encrypted.ciphertext.length <= Math.ceil(MAX_WINDOW_BYTES * 4 / 3) + 8
  ) {
    compactedWindow = encrypted
  } else if (encrypted !== undefined) {
    return null
  }
  return {
    id: state.id!,
    status: state.status!,
    model: state.model!,
    mode: state.mode!,
    ...(state.cursor !== undefined ? { cursor: state.cursor } : {}),
    ...(state.previousResponseId ? { previousResponseId: state.previousResponseId } : {}),
    createdAt: state.createdAt!,
    updatedAt: state.updatedAt!,
    ...(compactedWindow ? { compactedWindow } : {}),
  }
}

function publicState(state: PersistedState): OpenAIResponseState {
  const { compactedWindow: _encrypted, ...safe } = state
  return structuredClone(safe)
}

function encryptWindow(id: string, value: unknown, key: Buffer): EncryptedWindow {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  if (plaintext.byteLength > MAX_WINDOW_BYTES) {
    throw new Error(`Compacted Responses window exceeds ${MAX_WINDOW_BYTES} bytes`)
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`ur-openai-responses:v1:${id}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  }
}

function decryptWindow(id: string, value: EncryptedWindow, key: Buffer): unknown {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(value.iv, 'base64url'),
    )
    decipher.setAAD(Buffer.from(`ur-openai-responses:v1:${id}`, 'utf8'))
    decipher.setAuthTag(Buffer.from(value.tag, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64url')),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString('utf8'))
  } catch (error) {
    throw new Error('Unable to decrypt compacted OpenAI Responses state', { cause: error })
  }
}

export class OpenAIResponsesStateStore {
  readonly directory: string
  readonly path: string
  readonly #lockPath: string
  readonly #key?: Buffer
  readonly #maxEntries: number

  constructor(options: OpenAIResponsesStateStoreOptions = {}) {
    this.directory = stateDirectory(options)
    this.path = join(this.directory, 'state.json')
    this.#lockPath = join(this.directory, '.state.lock')
    this.#key = parseKey(options.encryptionKey ?? process.env.UR_OPENAI_RESPONSES_STATE_KEY)
    this.#maxEntries = Math.max(1, Math.min(options.maxEntries ?? DEFAULT_MAX_ENTRIES, 10_000))
  }

  list(): OpenAIResponseState[] {
    return this.#withLock(manifest => manifest.responses.map(publicState))
  }

  get(id: string): OpenAIResponseState | undefined {
    this.#assertId(id)
    return this.#withLock(manifest => {
      const state = manifest.responses.find(item => item.id === id)
      return state ? publicState(state) : undefined
    })
  }

  upsert(
    value: Omit<OpenAIResponseState, 'createdAt' | 'updatedAt'> &
      Partial<Pick<OpenAIResponseState, 'createdAt' | 'updatedAt'>>,
  ): OpenAIResponseState {
    this.#assertId(value.id)
    const candidate = normalizeState({
      ...value,
      createdAt: value.createdAt ?? new Date().toISOString(),
      updatedAt: value.updatedAt ?? new Date().toISOString(),
    })
    if (!candidate) throw new Error('Invalid OpenAI Responses state')
    return this.#withLock(manifest => {
      const existing = manifest.responses.find(item => item.id === candidate.id)
      const next: PersistedState = {
        ...candidate,
        createdAt: existing?.createdAt ?? candidate.createdAt,
        ...(existing?.compactedWindow ? { compactedWindow: existing.compactedWindow } : {}),
      }
      manifest.responses = [
        next,
        ...manifest.responses.filter(item => item.id !== next.id),
      ].slice(0, this.#maxEntries)
      this.#save(manifest)
      return publicState(next)
    })
  }

  remove(id: string): boolean {
    this.#assertId(id)
    return this.#withLock(manifest => {
      const before = manifest.responses.length
      manifest.responses = manifest.responses.filter(item => item.id !== id)
      if (manifest.responses.length !== before) this.#save(manifest)
      return manifest.responses.length !== before
    })
  }

  setCompactedWindow(id: string, output: unknown): void {
    this.#assertId(id)
    if (!this.#key) {
      throw new Error(
        'Refusing to persist compacted context without UR_OPENAI_RESPONSES_STATE_KEY (32-byte hex or base64)',
      )
    }
    this.#withLock(manifest => {
      const state = manifest.responses.find(item => item.id === id)
      if (!state) throw new Error(`Unknown OpenAI response state: ${id}`)
      state.compactedWindow = encryptWindow(id, output, this.#key!)
      state.updatedAt = new Date().toISOString()
      this.#save(manifest)
    })
  }

  getCompactedWindow(id: string): unknown | undefined {
    this.#assertId(id)
    return this.#withLock(manifest => {
      const encrypted = manifest.responses.find(item => item.id === id)?.compactedWindow
      if (!encrypted) return undefined
      if (!this.#key) {
        throw new Error('UR_OPENAI_RESPONSES_STATE_KEY is required to decrypt compacted context')
      }
      return decryptWindow(id, encrypted, this.#key)
    })
  }

  #assertId(id: string): void {
    if (!ID_RE.test(id)) throw new Error('Invalid OpenAI response id')
  }

  #withLock<T>(operation: (manifest: StateManifest) => T): T {
    validateDirectory(this.directory)
    ensurePrivateFile(this.path)
    ensurePrivateFile(this.#lockPath)
    try {
      const fd = openSync(this.#lockPath, 'wx', 0o600)
      closeSync(fd)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const release = acquireLock(this.#lockPath)
    try {
      return operation(this.#load())
    } finally {
      release()
    }
  }

  #load(): StateManifest {
    if (!existsSync(this.path)) return { version: 1, responses: [] }
    const bytes = readFileSync(this.path)
    if (bytes.byteLength > MAX_MANIFEST_BYTES) {
      throw new Error(`OpenAI Responses state exceeds ${MAX_MANIFEST_BYTES} bytes`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch (error) {
      throw new Error('OpenAI Responses state is not valid JSON', { cause: error })
    }
    const manifest = parsed as Partial<StateManifest>
    if (manifest.version !== 1 || !Array.isArray(manifest.responses)) {
      throw new Error('Unsupported OpenAI Responses state manifest')
    }
    const responses = manifest.responses.map(normalizeState)
    if (responses.some(item => item === null)) {
      throw new Error('OpenAI Responses state contains an invalid entry')
    }
    return { version: 1, responses: responses as PersistedState[] }
  }

  #save(manifest: StateManifest): void {
    const payload = `${JSON.stringify(manifest, null, 2)}\n`
    if (Buffer.byteLength(payload) > MAX_MANIFEST_BYTES) {
      throw new Error(`OpenAI Responses state exceeds ${MAX_MANIFEST_BYTES} bytes`)
    }
    const temporary = join(this.directory, `.state.${randomUUID()}.tmp`)
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600)
      writeFileSync(fd, payload, { encoding: 'utf8' })
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      renameSync(temporary, this.path)
      const directoryFd = openSync(this.directory, 'r')
      try {
        fsyncSync(directoryFd)
      } finally {
        closeSync(directoryFd)
      }
    } finally {
      if (fd !== undefined) closeSync(fd)
      rmSync(temporary, { force: true })
    }
  }
}
