import { randomUUID } from 'crypto'
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'fs/promises'
import { basename, dirname, join } from 'path'
import { getProjectsDir, getTranscriptPathForSession } from './sessionStorage.js'

const ARCHIVE_DIRECTORY = '.session-archive'

export type ArchivedSession = {
  sessionId: string
  archivedAt: string
  projectDir: string
  transcriptPath: string
}

type ArchiveManifest = {
  version: 1
  sessionId: string
  archivedAt: string
  projectDir: string
  transcriptFile: string
  dataDirectory?: string
  metadataFile?: string
}

function validateSessionId(sessionId: string): string {
  if (!/^[a-zA-Z0-9-]{1,128}$/u.test(sessionId)) {
    throw new Error('Invalid session ID')
  }
  return sessionId
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function archiveEntryDir(projectDir: string, sessionId: string): string {
  return join(projectDir, ARCHIVE_DIRECTORY, validateSessionId(sessionId))
}

async function ensureArchiveRoot(projectDir: string): Promise<string> {
  const root = join(projectDir, ARCHIVE_DIRECTORY)
  try {
    const stats = await lstat(root)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Session archive path is not a private directory: ${root}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(root, { mode: 0o700 })
  }
  return root
}

async function readManifest(entryDir: string): Promise<ArchiveManifest | null> {
  try {
    const entryStats = await lstat(entryDir)
    const manifestStats = await lstat(join(entryDir, 'manifest.json'))
    if (
      !entryStats.isDirectory() ||
      entryStats.isSymbolicLink() ||
      !manifestStats.isFile() ||
      manifestStats.isSymbolicLink()
    ) {
      return null
    }
    const value = JSON.parse(
      await readFile(join(entryDir, 'manifest.json'), 'utf8'),
    ) as Partial<ArchiveManifest>
    const expectedProjectDir = dirname(dirname(entryDir))
    if (
      value.version !== 1 ||
      value.sessionId !== basename(entryDir) ||
      typeof value.archivedAt !== 'string' ||
      Number.isNaN(Date.parse(value.archivedAt)) ||
      value.projectDir !== expectedProjectDir ||
      value.transcriptFile !== 'transcript.jsonl' ||
      (value.dataDirectory !== undefined && value.dataDirectory !== 'data') ||
      (value.metadataFile !== undefined &&
        value.metadataFile !== 'metadata.json')
    ) {
      return null
    }
    validateSessionId(value.sessionId)
    return value as ArchiveManifest
  } catch {
    return null
  }
}

export async function archiveSessionInProject(
  projectDir: string,
  sessionId: string,
): Promise<ArchivedSession> {
  validateSessionId(sessionId)
  const transcriptPath = join(projectDir, `${sessionId}.jsonl`)
  await ensureArchiveRoot(projectDir)
  const entryDir = archiveEntryDir(projectDir, sessionId)
  if (await pathExists(entryDir)) {
    throw new Error(`Session ${sessionId} is already archived`)
  }
  if (!(await pathExists(transcriptPath))) {
    throw new Error(`Session ${sessionId} was not found`)
  }

  const stagingDir = `${entryDir}.staging-${randomUUID()}`
  const transcriptFile = 'transcript.jsonl'
  const dataPath = join(projectDir, sessionId)
  const metadataPath = join(projectDir, `${sessionId}.meta.json`)
  const manifest: ArchiveManifest = {
    version: 1,
    sessionId,
    archivedAt: new Date().toISOString(),
    projectDir,
    transcriptFile,
    ...(await pathExists(dataPath) ? { dataDirectory: 'data' } : {}),
    ...(await pathExists(metadataPath) ? { metadataFile: 'metadata.json' } : {}),
  }

  await mkdir(stagingDir, { mode: 0o700 })
  try {
    await rename(transcriptPath, join(stagingDir, transcriptFile))
    if (manifest.dataDirectory) {
      await rename(dataPath, join(stagingDir, manifest.dataDirectory))
    }
    if (manifest.metadataFile) {
      await rename(metadataPath, join(stagingDir, manifest.metadataFile))
    }
    await writeFile(
      join(stagingDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { mode: 0o600 },
    )
    await rename(stagingDir, entryDir)
  } catch (error) {
    // Roll back anything already moved so a failed archive never hides a
    // resumable conversation.
    if (await pathExists(join(stagingDir, transcriptFile))) {
      await rename(join(stagingDir, transcriptFile), transcriptPath)
    }
    if (
      manifest.dataDirectory &&
      (await pathExists(join(stagingDir, manifest.dataDirectory)))
    ) {
      await rename(join(stagingDir, manifest.dataDirectory), dataPath)
    }
    if (
      manifest.metadataFile &&
      (await pathExists(join(stagingDir, manifest.metadataFile)))
    ) {
      await rename(join(stagingDir, manifest.metadataFile), metadataPath)
    }
    await rm(stagingDir, { recursive: true, force: true })
    throw error
  }

  return {
    sessionId,
    archivedAt: manifest.archivedAt,
    projectDir,
    transcriptPath,
  }
}

export async function archiveSession(
  sessionId: string,
  transcriptPath = getTranscriptPathForSession(sessionId),
): Promise<ArchivedSession> {
  return archiveSessionInProject(dirname(transcriptPath), sessionId)
}

async function projectDirectories(): Promise<string[]> {
  let entries
  try {
    entries = await readdir(getProjectsDir(), { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => join(getProjectsDir(), entry.name))
}

async function findArchivedEntry(
  sessionId: string,
): Promise<{ entryDir: string; manifest: ArchiveManifest } | null> {
  validateSessionId(sessionId)
  for (const projectDir of await projectDirectories()) {
    const entryDir = archiveEntryDir(projectDir, sessionId)
    const manifest = await readManifest(entryDir)
    if (manifest?.sessionId === sessionId) return { entryDir, manifest }
  }
  return null
}

async function restoreArchivedEntry(
  entryDir: string,
  manifest: ArchiveManifest,
): Promise<ArchivedSession> {
  const { sessionId } = manifest
  const transcriptPath = join(manifest.projectDir, `${sessionId}.jsonl`)
  const archivedTranscriptPath = join(entryDir, manifest.transcriptFile)
  const transcriptStats = await lstat(archivedTranscriptPath)
  if (!transcriptStats.isFile() || transcriptStats.isSymbolicLink()) {
    throw new Error(`Cannot restore ${sessionId}: archived transcript is not a regular file`)
  }
  if (await pathExists(transcriptPath)) {
    throw new Error(`Cannot restore ${sessionId}: an active session already uses that ID`)
  }

  const dataTarget = manifest.dataDirectory
    ? join(manifest.projectDir, sessionId)
    : undefined
  const metadataTarget = manifest.metadataFile
    ? join(manifest.projectDir, `${sessionId}.meta.json`)
    : undefined
  if (manifest.dataDirectory) {
    const dataStats = await lstat(join(entryDir, manifest.dataDirectory))
    if (!dataStats.isDirectory() || dataStats.isSymbolicLink()) {
      throw new Error(`Cannot restore ${sessionId}: archived data is not a regular directory`)
    }
    if (await pathExists(dataTarget!)) {
      throw new Error(`Cannot restore ${sessionId}: its data directory already exists`)
    }
  }
  if (manifest.metadataFile) {
    const metadataStats = await lstat(join(entryDir, manifest.metadataFile))
    if (!metadataStats.isFile() || metadataStats.isSymbolicLink()) {
      throw new Error(`Cannot restore ${sessionId}: archived metadata is not a regular file`)
    }
    if (await pathExists(metadataTarget!)) {
      throw new Error(`Cannot restore ${sessionId}: its metadata file already exists`)
    }
  }

  let dataMoved = false
  let metadataMoved = false
  let transcriptMoved = false
  const cleanupDir = `${entryDir}.restored-${randomUUID()}`
  try {
    if (manifest.dataDirectory && dataTarget) {
      await rename(join(entryDir, manifest.dataDirectory), dataTarget)
      dataMoved = true
    }
    if (manifest.metadataFile && metadataTarget) {
      await rename(join(entryDir, manifest.metadataFile), metadataTarget)
      metadataMoved = true
    }
    // Move the transcript last. Resume discovery cannot observe a partial restore.
    await rename(archivedTranscriptPath, transcriptPath)
    transcriptMoved = true
    // Atomically remove the entry from archive discovery before best-effort
    // cleanup of its now payload-free directory.
    await rename(entryDir, cleanupDir)
  } catch (error) {
    const rollbackErrors: unknown[] = []
    const rollBack = async (from: string, to: string): Promise<void> => {
      try {
        await rename(from, to)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (transcriptMoved) await rollBack(transcriptPath, archivedTranscriptPath)
    if (metadataMoved && metadataTarget && manifest.metadataFile) {
      await rollBack(metadataTarget, join(entryDir, manifest.metadataFile))
    }
    if (dataMoved && dataTarget && manifest.dataDirectory) {
      await rollBack(dataTarget, join(entryDir, manifest.dataDirectory))
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Could not restore ${sessionId}; rollback was incomplete`,
      )
    }
    throw error
  }
  await rm(cleanupDir, { recursive: true, force: true }).catch(() => {})

  return {
    sessionId,
    archivedAt: manifest.archivedAt,
    projectDir: manifest.projectDir,
    transcriptPath,
  }
}

export async function unarchiveSessionInProject(
  projectDir: string,
  sessionId: string,
): Promise<ArchivedSession> {
  const entryDir = archiveEntryDir(projectDir, sessionId)
  const manifest = await readManifest(entryDir)
  if (!manifest || manifest.sessionId !== sessionId) {
    throw new Error(`Archived session ${sessionId} was not found`)
  }
  return restoreArchivedEntry(entryDir, manifest)
}

export async function unarchiveSession(sessionId: string): Promise<ArchivedSession> {
  const found = await findArchivedEntry(sessionId)
  if (!found) throw new Error(`Archived session ${sessionId} was not found`)
  return restoreArchivedEntry(found.entryDir, found.manifest)
}

export async function listArchivedSessions(): Promise<ArchivedSession[]> {
  const sessions: ArchivedSession[] = []
  for (const projectDir of await projectDirectories()) {
    const root = join(projectDir, ARCHIVE_DIRECTORY)
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.includes('.staging-') ||
        entry.name.includes('.restored-')
      ) {
        continue
      }
      const manifest = await readManifest(join(root, entry.name))
      if (!manifest) continue
      sessions.push({
        sessionId: manifest.sessionId,
        archivedAt: manifest.archivedAt,
        projectDir: manifest.projectDir,
        transcriptPath: join(
          manifest.projectDir,
          basename(`${manifest.sessionId}.jsonl`),
        ),
      })
    }
  }
  return sessions.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
}
