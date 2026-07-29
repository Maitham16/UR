import { expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { builtinModules } from 'node:module'

// cli-highlight was imported by four rendering surfaces and declared nowhere.
// Its loader caught the resolution failure and returned null, so every code
// block in every assistant message rendered as unstyled plain text, with no
// error, for as long as the fork has existed. The build never caught it
// because the import is dynamic — bundlers resolve those lazily.

const SOURCE_ROOT = 'src'

// Anchored at line start. An unanchored `from` let the lazy span run across
// unrelated string literals and reported ~37 phantom packages. `require(...)`
// is deliberately not scanned: this codebase is ESM, so the only occurrences
// in src are inside string literals (code templates in security/lab.ts).
const STATIC_IMPORT =
  /^\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]/gm
/** Side-effect imports: `import 'foo'`, no bindings, no `from`. */
const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
const TYPEOF_IMPORT = /\btypeof\s+import\(\s*['"]([^'"]+)['"]\s*\)/g
const PATTERNS = [
  STATIC_IMPORT,
  SIDE_EFFECT_IMPORT,
  DYNAMIC_IMPORT,
  TYPEOF_IMPORT,
] as const

/** Native addons resolved at runtime with a graceful fallback when absent. */
const OPTIONAL_NATIVE = /(?:-napi|\.node)$/

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, found)
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) found.push(full)
  }
  return found
}

/** "@scope/pkg/sub" -> "@scope/pkg"; "pkg/sub" -> "pkg". */
function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

/**
 * Modules with a `declare module 'x'` ambient shim. Each is imported
 * dynamically behind a fallback, so absence is a documented degradation
 * rather than a missing dependency.
 */
function ambientlyDeclared(): Set<string> {
  const shims = readFileSync('src/types/missing-modules.d.ts', 'utf8')
  return new Set(
    [...shims.matchAll(/^\s*declare\s+module\s+['"]([^'"]+)['"]/gm)].map(m =>
      packageName(m[1]!),
    ),
  )
}

/** tsconfig `paths` entries redirect bare specifiers to local source. */
function aliased(): Set<string> {
  const raw = readFileSync('tsconfig.json', 'utf8')
  return new Set(
    [...raw.matchAll(/^\s*"([^"]+)"\s*:\s*\[/gm)].map(m =>
      packageName(m[1]!.replace(/\/\*$/, '')),
    ),
  )
}

function isExternal(specifier: string): boolean {
  if (specifier.startsWith('.')) return false
  // Absolute-from-root imports used across the codebase, eg 'src/utils/x.js'.
  if (specifier.startsWith('src/')) return false
  if (specifier.startsWith('node:')) return false
  if (specifier.startsWith('bun:')) return false
  if (builtinModules.includes(packageName(specifier))) return false
  if (OPTIONAL_NATIVE.test(specifier)) return false
  return true
}

test('every external module imported by src is declared in package.json', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const exempt = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...ambientlyDeclared(),
    ...aliased(),
    // Self-reference: SDK docs embed `from 'ur-agent/sdk'` in code examples.
    pkg.name,
  ])

  const undeclared = new Map<string, string>()
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1]
        if (!specifier || !isExternal(specifier)) continue
        const name = packageName(specifier)
        if (!exempt.has(name) && !undeclared.has(name)) {
          undeclared.set(name, file)
        }
      }
    }
  }

  const report = [...undeclared]
    .map(([name, file]) => `  ${name} (first seen in ${file})`)
    .join('\n')
  expect(report).toBe('')
})

test('cli-highlight specifically is declared', () => {
  // The regression that motivated the check above. Kept explicit so a future
  // loosening of the scanner cannot quietly drop this case.
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const declared = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  }
  expect(declared['cli-highlight']).toBeString()
})

test('cli-highlight has no ambient shim hiding its absence', () => {
  // A `declare module 'cli-highlight'` would satisfy the typechecker and
  // re-hide exactly the failure this file exists to catch.
  expect(ambientlyDeclared().has('cli-highlight')).toBe(false)
})

test('a failed highlighter load is reported, not swallowed', () => {
  const source = readFileSync('src/utils/cliHighlight.ts', 'utf8')
  const loader = source.slice(source.indexOf('async function loadCliHighlight'))
  const body = loader.slice(0, loader.indexOf('\n}\n'))
  expect(body).toContain('logError')
  expect(body).not.toMatch(/catch\s*\{\s*return null/)
})
