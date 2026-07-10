/**
 * WorkspaceEdit application and patch formatting.
 *
 * All AST engines produce the same `TextEdit` shape. This module applies those
 * edits safely: it validates that edits within a file do not overlap, sorts them
 * by descending start position, applies them in one pass, and returns rollback
 * snapshots.
 */

import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createTwoFilesPatch } from 'diff'
import type { TextEdit, WorkspaceEdit } from './types.js'

export type ApplyWorkspaceEditResult = {
  writtenFiles: string[]
  snapshots: Map<string, FileSnapshot>
}

export type FileSnapshot = {
  content: string
  existed: boolean
  mode?: number
}

export class OverlappingEditError extends Error {
  constructor(file: string) {
    super(`Overlapping edits detected in ${file}`)
    this.name = 'OverlappingEditError'
  }
}

function groupByFile(edits: TextEdit[]): Map<string, TextEdit[]> {
  const groups = new Map<string, TextEdit[]>()
  for (const edit of edits) {
    const list = groups.get(edit.file) ?? []
    list.push(edit)
    groups.set(edit.file, list)
  }
  return groups
}

function normalizeFileEdits(file: string, edits: TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const curr = sorted[i]!
    if (curr.end > prev.start) {
      throw new OverlappingEditError(file)
    }
  }
  return sorted
}

function applyFileEdits(content: string, edits: TextEdit[]): string {
  let result = content
  for (const edit of edits) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > content.length
    ) {
      throw new Error(`Invalid edit range ${edit.start}:${edit.end} for ${edit.file}`)
    }
    if (edit.oldText !== undefined && content.slice(edit.start, edit.end) !== edit.oldText) {
      throw new Error(`Stale edit rejected for ${edit.file} at ${edit.start}:${edit.end}`)
    }
    result = `${result.slice(0, edit.start)}${edit.newText}${result.slice(edit.end)}`
  }
  return result
}

function realpathForMissing(path: string): string {
  const suffix: string[] = []
  let cursor = path
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) return path
    suffix.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
    cursor = parent
  }
  return resolve(realpathSync(cursor), ...suffix)
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export function resolveWorkspaceFile(root: string, file: string): string {
  if (!file || file.includes('\0')) throw new Error('Workspace edit path is empty or invalid')
  const realRoot = realpathSync(root)
  const candidate = isAbsolute(file) ? resolve(file) : resolve(realRoot, file)
  if (!isWithin(realRoot, candidate)) {
    throw new Error(`Path escapes repository root: ${file}`)
  }
  const canonical = existsSync(candidate) ? realpathSync(candidate) : realpathForMissing(candidate)
  if (!isWithin(realRoot, canonical)) {
    throw new Error(`Path resolves outside repository root: ${file}`)
  }
  return canonical
}

export function workspaceRelativePath(root: string, file: string): string {
  return relative(realpathSync(root), resolveWorkspaceFile(root, file)).split(sep).join('/')
}

function atomicWrite(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = resolve(dirname(path), `.${randomUUID()}.ur-repo-edit.tmp`)
  try {
    writeFileSync(temp, content, { flag: 'wx', ...(mode !== undefined ? { mode } : {}) })
    renameSync(temp, path)
    if (mode !== undefined) chmodSync(path, mode)
  } finally {
    rmSync(temp, { force: true })
  }
}

export function applyWorkspaceEdit(
  root: string,
  edit: WorkspaceEdit,
): ApplyWorkspaceEditResult {
  const snapshots = new Map<string, FileSnapshot>()
  const writtenFiles: string[] = []
  const normalizedEdits = edit.edits.map(item => ({
    ...item,
    file: workspaceRelativePath(root, item.file),
  }))
  const byFile = groupByFile(normalizedEdits)
  const prepared: Array<{ file: string; abs: string; newContent: string; mode?: number }> = []

  for (const [file, rawEdits] of byFile) {
    const edits = normalizeFileEdits(file, rawEdits)
    const abs = resolveWorkspaceFile(root, file)
    const existed = existsSync(abs)
    const oldContent = existed ? readFileSync(abs, 'utf-8') : ''
    const mode = existed ? statSync(abs).mode : undefined
    const newContent = applyFileEdits(oldContent, edits)
    snapshots.set(file, { content: oldContent, existed, mode })
    prepared.push({ file, abs, newContent, mode })
  }

  try {
    for (const file of prepared) {
      atomicWrite(file.abs, file.newContent, file.mode)
      writtenFiles.push(file.file)
    }
  } catch (error) {
    rollbackWorkspaceEdit(root, snapshots)
    throw error
  }

  return { writtenFiles, snapshots }
}

export function rollbackWorkspaceEdit(
  root: string,
  snapshots: Map<string, FileSnapshot>,
): void {
  const realRoot = realpathSync(root)
  for (const [file, snapshot] of snapshots) {
    const abs = resolveWorkspaceFile(realRoot, file)
    if (snapshot.existed) {
      atomicWrite(abs, snapshot.content, snapshot.mode)
      continue
    }
    rmSync(abs, { force: true, recursive: true })
    let parent = dirname(abs)
    while (parent !== realRoot && isWithin(realRoot, parent)) {
      try {
        rmdirSync(parent)
      } catch {
        break
      }
      parent = dirname(parent)
    }
  }
}

export function formatWorkspaceEditAsPatch(root: string, edit: WorkspaceEdit): string {
  const byFile = groupByFile(edit.edits)
  const pieces: string[] = []
  for (const [file] of byFile) {
    const safeFile = workspaceRelativePath(root, file)
    const abs = resolveWorkspaceFile(root, safeFile)
    const oldContent = existsSync(abs) ? readFileSync(abs, 'utf-8') : ''
    const sorted = [...(byFile.get(file) ?? [])].sort((a, b) => b.start - a.start)
    const newContent = applyFileEdits(oldContent, sorted)
    pieces.push(
      createTwoFilesPatch(
        `a/${file}`,
        `b/${file}`,
        oldContent,
        newContent,
        undefined,
        undefined,
        { context: 3 },
      ),
    )
  }
  return pieces.join('\n')
}

export function workspaceEditFromLsp(
  root: string,
  lspEdit: unknown,
): WorkspaceEdit {
  if (!lspEdit || typeof lspEdit !== 'object') return { edits: [] }

  const edits: TextEdit[] = []
  const docChanges =
    'documentChanges' in lspEdit && Array.isArray(lspEdit.documentChanges)
      ? lspEdit.documentChanges
      : []
  const changes =
    'changes' in lspEdit && lspEdit.changes && typeof lspEdit.changes === 'object'
      ? (lspEdit.changes as Record<string, unknown>)
      : {}

  for (const [uri, textEdits] of Object.entries(changes)) {
    const abs = uriToAbsolutePath(root, uri)
    const content = readFileSync(abs, 'utf-8')
    const file = absoluteToRelative(root, abs)
    for (const raw of Array.isArray(textEdits) ? textEdits : []) {
      const converted = lspTextEditToEdit(file, content, raw)
      if (converted) edits.push(converted)
    }
  }

  for (const change of docChanges) {
    if (!change || typeof change !== 'object') continue
    const uri =
      'textDocument' in change &&
      change.textDocument &&
      typeof change.textDocument === 'object'
        ? (change.textDocument as { uri?: string }).uri
        : undefined
    if (!uri) continue
    const abs = uriToAbsolutePath(root, uri)
    const content = readFileSync(abs, 'utf-8')
    const file = absoluteToRelative(root, abs)
    const textEdits =
      'edits' in change && Array.isArray(change.edits) ? change.edits : []
    for (const raw of textEdits) {
      const converted = lspTextEditToEdit(file, content, raw)
      if (converted) edits.push(converted)
    }
  }

  return { edits }
}

function uriToAbsolutePath(root: string, uri: string): string {
  let path = uri.replace(/^file:\/\//, '')
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  try {
    path = decodeURIComponent(path)
  } catch {
    // keep raw URI
  }
  return resolveWorkspaceFile(root, path)
}

function absoluteToRelative(root: string, abs: string): string {
  return workspaceRelativePath(root, abs)
}

function lspTextEditToEdit(
  file: string,
  content: string,
  raw: unknown,
): TextEdit | null {
  if (!raw || typeof raw !== 'object') return null
  const range = 'range' in raw ? (raw as { range?: unknown }).range : undefined
  if (!range || typeof range !== 'object') return null
  const start = (range as { start?: { line?: number; character?: number } }).start
  const end = (range as { end?: { line?: number; character?: number } }).end
  if (!start || !end) return null
  const newText = 'newText' in raw ? String((raw as { newText?: unknown }).newText) : ''
  return {
    file,
    start: lineCharToOffset(content, start.line ?? 0, start.character ?? 0),
    end: lineCharToOffset(content, end.line ?? 0, end.character ?? 0),
    newText,
  }
}

function lineCharToOffset(content: string, line: number, character: number): number {
  const lines = content.split('\n')
  let offset = 0
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i]!.length + 1 // +1 for newline
  }
  const targetLine = lines[line]
  if (!targetLine) return offset
  return offset + Math.min(character, targetLine.length)
}
