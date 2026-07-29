// File-backed access to .ur/ide/diffs — the same manifest + patches +
// metadata bundle store that src/services/agents/ideDiffs.ts owns on the
// CLI side. Read/write here stays a thin mirror of that on-disk format.

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { DiffArtifact, DiffManifest } from '../bridge/types.js'
import {
  safeWorkspacePath,
  writeWorkspaceJsonAtomic,
} from '../util/safeWorkspacePath.js'

export function workspaceRoot(): string | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri
  return (activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined)?.uri.fsPath
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

export function diffsRoot(root: string): string {
  return path.join(root, '.ur', 'ide', 'diffs')
}

export function manifestPath(root: string): string {
  return path.join(diffsRoot(root), 'manifest.json')
}

export function patchPath(root: string, bundle: DiffArtifact): string {
  return artifactPath(root, bundle, 'patch')
}

export function metadataPath(root: string, bundle: DiffArtifact): string {
  return artifactPath(root, bundle, 'metadata')
}

const DIFF_ID_PATTERN = /^diff-[1-9][0-9]*$/u
const DIFF_STATUSES = new Set(['pending', 'commented', 'approved', 'rejected'])
const MAX_DIFF_JSON_BYTES = 16 * 1024 * 1024
const MAX_PATCH_BYTES = 64 * 1024 * 1024

function artifactPath(root: string, bundle: DiffArtifact, kind: 'patch' | 'metadata'): string {
  if (!DIFF_ID_PATTERN.test(bundle.id)) throw new Error(`Invalid UR diff id: ${bundle.id}`)
  const relative = kind === 'patch' ? bundle.patchFile : bundle.metadataFile
  const expected = kind === 'patch' ? `patches/${bundle.id}.patch` : `metadata/${bundle.id}.json`
  if (relative.replaceAll('\\', '/') !== expected) {
    throw new Error(`Invalid UR diff ${kind} path for ${bundle.id}`)
  }
  const rootPath = path.resolve(diffsRoot(root))
  const target = path.resolve(rootPath, relative)
  if (!target.startsWith(`${rootPath}${path.sep}`)) throw new Error(`UR diff ${kind} path escapes the diff store`)
  return safeWorkspacePath(root, target, `UR diff ${kind}`)
}

function isValidBundle(root: string, value: unknown): value is DiffArtifact {
  if (!isRecord(value)) return false
  const bundle = value as unknown as DiffArtifact
  try {
    patchPath(root, bundle)
    metadataPath(root, bundle)
    return (
      typeof bundle.title === 'string' &&
      bundle.title.length > 0 &&
      DIFF_STATUSES.has(bundle.status) &&
      (bundle.baseRef === undefined || typeof bundle.baseRef === 'string') &&
      (bundle.staged === undefined || typeof bundle.staged === 'boolean') &&
      Array.isArray(bundle.files) &&
      bundle.files.every(isValidFileChange) &&
      Array.isArray(bundle.comments) &&
      bundle.comments.every(isValidComment) &&
      typeof bundle.createdAt === 'string' &&
      typeof bundle.updatedAt === 'string'
    )
  } catch {
    return false
  }
}

function readJson<T>(
  root: string,
  file: string,
  fallback: T,
  maxBytes = MAX_DIFF_JSON_BYTES,
): T {
  try {
    const safeFile = safeWorkspacePath(root, file, 'UR diff')
    const size = fs.statSync(safeFile).size
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      return fallback
    }
    return JSON.parse(fs.readFileSync(safeFile, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(root: string, file: string, value: unknown): void {
  writeWorkspaceJsonAtomic(root, file, value, 'UR diff')
}

export function loadManifest(root: string): DiffManifest {
  const manifest = readJson<DiffManifest>(
    root,
    manifestPath(root),
    { version: 1, diffs: [] },
  )
  return isRecord(manifest) && Array.isArray(manifest.diffs)
    ? {
        version: 1,
        diffs: manifest.diffs.filter(bundle => isValidBundle(root, bundle)),
      }
    : { version: 1, diffs: [] }
}

export function loadBundleMetadata(root: string, bundle: DiffArtifact): DiffArtifact {
  const metadata = readJson<DiffArtifact>(
    root,
    metadataPath(root, bundle),
    bundle,
  )
  return isValidBundle(root, metadata) && metadata.id === bundle.id
    ? metadata
    : bundle
}

export function readPatch(root: string, bundle: DiffArtifact): string {
  const file = patchPath(root, bundle)
  if (!fs.existsSync(file)) return ''
  const size = fs.statSync(file).size
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_PATCH_BYTES) {
    throw new Error(`UR diff patch exceeds ${MAX_PATCH_BYTES / (1024 * 1024)} MiB`)
  }
  return fs.readFileSync(file, 'utf8')
}

export function writeManifest(root: string, manifest: DiffManifest): void {
  writeJson(root, manifestPath(root), manifest)
}

export function writeBundleMetadata(root: string, bundle: DiffArtifact): void {
  writeJson(root, metadataPath(root, bundle), bundle)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isValidFileChange(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.path === 'string' &&
    Number.isSafeInteger(value.additions) &&
    Number(value.additions) >= 0 &&
    Number.isSafeInteger(value.deletions) &&
    Number(value.deletions) >= 0
  )
}

function isValidComment(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.at === 'string' &&
    typeof value.text === 'string' &&
    (value.file === undefined || typeof value.file === 'string') &&
    (value.line === undefined ||
      (Number.isSafeInteger(value.line) && Number(value.line) > 0))
  )
}
