/**
 * WorkspaceEdit application and patch formatting.
 *
 * All AST engines produce the same `TextEdit` shape. This module applies those
 * edits safely: it validates that edits within a file do not overlap, sorts them
 * by descending start position, applies them in one pass, and returns rollback
 * snapshots.
 */

import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createTwoFilesPatch } from 'diff'
import type { TextEdit, WorkspaceEdit } from './types.js'

export type ApplyWorkspaceEditResult = {
  writtenFiles: string[]
  snapshots: Map<string, string>
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
    result = `${result.slice(0, edit.start)}${edit.newText}${result.slice(edit.end)}`
  }
  return result
}

export function applyWorkspaceEdit(
  root: string,
  edit: WorkspaceEdit,
): ApplyWorkspaceEditResult {
  const snapshots = new Map<string, string>()
  const writtenFiles: string[] = []
  const byFile = groupByFile(edit.edits)

  for (const [file, rawEdits] of byFile) {
    const edits = normalizeFileEdits(file, rawEdits)
    const abs = join(root, file)
    const oldContent = existsSync(abs) ? readFileSync(abs, 'utf-8') : ''
    const newContent = applyFileEdits(oldContent, edits)
    snapshots.set(file, oldContent)
    if (!existsSync(abs)) {
      mkdirSync(dirname(abs), { recursive: true })
    }
    writeFileSync(abs, newContent)
    writtenFiles.push(file)
  }

  return { writtenFiles, snapshots }
}

export function rollbackWorkspaceEdit(
  root: string,
  snapshots: Map<string, string>,
): void {
  for (const [file, content] of snapshots) {
    writeFileSync(join(root, file), content)
  }
}

export function formatWorkspaceEditAsPatch(root: string, edit: WorkspaceEdit): string {
  const byFile = groupByFile(edit.edits)
  const pieces: string[] = []
  for (const [file] of byFile) {
    const abs = join(root, file)
    const oldContent = readFileSync(abs, 'utf-8')
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
  return path.startsWith('/') ? path : join(root, path)
}

function absoluteToRelative(root: string, abs: string): string {
  return abs.replace(root, '').replace(/^\//, '')
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
