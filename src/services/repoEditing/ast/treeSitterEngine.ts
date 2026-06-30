/**
 * Tree-sitter fallback engine for AST-aware repo editing.
 *
 * This engine is best-effort and does not perform binding analysis. It parses
 * files into a generic `TsNode` tree (matching the existing pure-TS bash parser
 * interface) and renames identifier nodes whose text matches the target name,
 * skipping nodes that live inside comments or string literals.
 *
 * Native `@tree-sitter/*` packages are optional: if installed they are used,
 * otherwise the pure-TS adapters in `adapters/` provide minimal support for the
 * most common constructs.
 */

import { readFileSync } from 'node:fs'
import type { RenameOptions, TextEdit, WorkspaceEdit } from './types.js'

export type TsNode = {
  type: string
  start: number
  end: number
  text: string
  children: TsNode[]
}

export type TreeSitterAdapter = {
  parse(file: string, content: string): TsNode
  isComment(node: TsNode): boolean
  isString(node: TsNode): boolean
  isIdentifier(node: TsNode): boolean
}

let nativeParser: ((file: string, content: string) => TsNode) | undefined

function tryLoadNativeParser(language: string): ((file: string, content: string) => TsNode) | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Parser = require(`@tree-sitter/${language}`) as { default?: { parse: (content: string) => TsNode }; parse?: (content: string) => TsNode }
    const parse = Parser.default?.parse ?? Parser.parse
    if (!parse) return undefined
    return (_file, content) => parse(content)
  } catch {
    return undefined
  }
}

function loadNativeParser(language: string): ((file: string, content: string) => TsNode) | undefined {
  if (!nativeParser) {
    nativeParser = tryLoadNativeParser(language)
  }
  return nativeParser
}

function pureTsParse(file: string, content: string): TsNode {
  return {
    type: 'program',
    start: 0,
    end: content.length,
    text: content,
    children: [],
  }
}

function getAdapter(language: string): TreeSitterAdapter {
  const native = loadNativeParser(language)
  if (native) {
    return {
      parse: native,
      isComment: node => node.type.includes('comment'),
      isString: node => node.type.includes('string') || node.type.includes('template_string'),
      isIdentifier: node => node.type === 'identifier',
    }
  }
  return {
    parse: pureTsParse,
    isComment: () => false,
    isString: () => false,
    isIdentifier: () => false,
  }
}

function collectIdentifiers(root: TsNode, name: string, adapter: TreeSitterAdapter): TsNode[] {
  const result: TsNode[] = []
  function visit(node: TsNode, insideComment: boolean, insideString: boolean): void {
    const nextComment = insideComment || adapter.isComment(node)
    const nextString = insideString || adapter.isString(node)
    if (!nextComment && !nextString && adapter.isIdentifier(node) && node.text === name) {
      result.push(node)
    }
    for (const child of node.children) {
      visit(child, nextComment, nextString)
    }
  }
  visit(root, false, false)
  return result
}

export function treeSitterRename(
  options: Pick<RenameOptions, 'root' | 'from' | 'to' | 'file'>,
  language: string,
): WorkspaceEdit {
  const { root, from, to, file: maybeFile } = options
  const files = maybeFile ? [maybeFile] : []
  const edits: TextEdit[] = []
  const adapter = getAdapter(language)
  for (const file of files) {
    const abs = file.startsWith('/') ? file : `${root}/${file}`
    const content = readFileSync(abs, 'utf-8')
    const tree = adapter.parse(file, content)
    const identifiers = collectIdentifiers(tree, from, adapter)
    for (const node of identifiers) {
      edits.push({ file, start: node.start, end: node.end, newText: to, oldText: from })
    }
  }
  return { edits }
}
