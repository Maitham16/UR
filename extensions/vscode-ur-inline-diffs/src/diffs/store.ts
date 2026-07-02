// File-backed access to .ur/ide/diffs — the same manifest + patches +
// metadata bundle store that src/services/agents/ideDiffs.ts owns on the
// CLI side. Read/write here stays a thin mirror of that on-disk format.

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { DiffArtifact, DiffManifest } from '../bridge/types.js'

export function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

export function diffsRoot(root: string): string {
  return path.join(root, '.ur', 'ide', 'diffs')
}

export function manifestPath(root: string): string {
  return path.join(diffsRoot(root), 'manifest.json')
}

export function patchPath(root: string, bundle: DiffArtifact): string {
  return path.join(diffsRoot(root), bundle.patchFile)
}

export function metadataPath(root: string, bundle: DiffArtifact): string {
  return path.join(diffsRoot(root), bundle.metadataFile)
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
  return Array.isArray(manifest.diffs) ? manifest : { version: 1, diffs: [] }
}

export function loadBundleMetadata(root: string, bundle: DiffArtifact): DiffArtifact {
  return readJson(metadataPath(root, bundle), bundle)
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
