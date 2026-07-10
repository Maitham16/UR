// File-backed access to .ur/ide/diffs — the same manifest + patches +
// metadata bundle store that src/services/agents/ideDiffs.ts owns on the
// CLI side. Read/write here stays a thin mirror of that on-disk format.

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { DiffArtifact, DiffManifest } from '../bridge/types.js'

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
  return target
}

function isValidBundle(value: unknown): value is DiffArtifact {
  if (!value || typeof value !== 'object') return false
  const bundle = value as DiffArtifact
  try {
    patchPath('.', bundle)
    metadataPath('.', bundle)
    return true
  } catch {
    return false
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function loadManifest(root: string): DiffManifest {
  const manifest = readJson<DiffManifest>(manifestPath(root), { version: 1, diffs: [] })
  return Array.isArray(manifest.diffs)
    ? { version: 1, diffs: manifest.diffs.filter(isValidBundle) }
    : { version: 1, diffs: [] }
}

export function loadBundleMetadata(root: string, bundle: DiffArtifact): DiffArtifact {
  const metadata = readJson<DiffArtifact>(metadataPath(root, bundle), bundle)
  return isValidBundle(metadata) && metadata.id === bundle.id ? metadata : bundle
}

export function readPatch(root: string, bundle: DiffArtifact): string {
  const file = patchPath(root, bundle)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

export function writeManifest(root: string, manifest: DiffManifest): void {
  writeJson(manifestPath(root), manifest)
}

export function writeBundleMetadata(root: string, bundle: DiffArtifact): void {
  writeJson(metadataPath(root, bundle), bundle)
}
