import { posix } from 'node:path'

const SRC_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.py']

const IMPORT_RES = [
  /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*from\s+([.\w]+)\s+import\b/gm,
  /^\s*import\s+([.\w]+)/gm,
]

const SYMBOL_RES = [
  /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*class\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*def\s+([A-Za-z_][\w]*)/gm,
  /^\s*class\s+([A-Za-z_][\w]*)\s*[:(]/gm,
]

function matchAll(text: string, regexes: RegExp[]): string[] {
  const out: string[] = []
  for (const re of regexes) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[1]) out.push(m[1])
    }
  }
  return out
}

export function extractImports(content: string): string[] {
  return [...new Set(matchAll(content, IMPORT_RES))]
}

export function extractSymbols(content: string): string[] {
  return [...new Set(matchAll(content, SYMBOL_RES))]
}

/** Candidate file paths for an import target path (handles .js→.ts, index, ext-less). */
function candidates(targetNoExt: string): string[] {
  const list: string[] = []
  for (const ext of SRC_EXT) list.push(`${targetNoExt}${ext}`)
  for (const ext of SRC_EXT) list.push(posix.join(targetNoExt, `index${ext}`))
  return list
}

/** Resolve an import specifier to an internal repo file, or null if external. Pure. */
export function resolveImport(
  fromFile: string,
  spec: string,
  fileSet: Set<string>,
): string | null {
  let rel: string | null = null
  if (spec.startsWith('.') && /[\\/]/.test(spec)) {
    // JS/TS relative path import.
    rel = posix.normalize(posix.join(posix.dirname(fromFile), spec))
  } else if (spec.startsWith('.')) {
    // Python relative import: leading dots = parent levels, rest = path segments.
    const dots = spec.match(/^\.+/)?.[0].length ?? 1
    const rest = spec.slice(dots).replace(/\./g, '/')
    let base = posix.dirname(fromFile)
    for (let i = 1; i < dots; i++) base = posix.dirname(base)
    rel = posix.normalize(posix.join(base, rest))
  } else {
    return null // bare/external specifier
  }
  if (fileSet.has(rel)) return rel
  const noExt = rel.replace(/\.(?:m|c)?[jt]sx?$/, '').replace(/\.py$/, '')
  for (const candidate of candidates(noExt)) {
    if (fileSet.has(candidate)) return candidate
  }
  return null
}
