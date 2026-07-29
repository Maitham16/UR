// highlight.js's type defs carry `/// <reference lib="dom" />`. SSETransport,
// mcp/client, ssh, dumpPrompts use DOM types (TextDecodeOptions, RequestInfo)
// that rely on DOM declarations. tsconfig has lib: ["ESNext"] only, so keep
// this explicit reference while still typechecking this module normally.
/// <reference lib="dom" />

import { extname } from 'path'
import { logError } from './log.js'

export type CliHighlight = {
  highlight: typeof import('cli-highlight').highlight
  supportsLanguage: typeof import('cli-highlight').supportsLanguage
}

// One promise shared by Fallback.tsx, markdown.ts, events.ts, getLanguageName.
// The highlight.js import piggybacks: cli-highlight has already pulled it into
// the module cache, so the second import() is a cache hit — no extra bytes
// faulted in.
let cliHighlightPromise: Promise<CliHighlight | null> | undefined

type GetHighlightLanguage = (
  languageName: string,
) => import('highlight.js').Language | undefined

let loadedGetLanguage: GetHighlightLanguage | undefined

async function loadCliHighlight(): Promise<CliHighlight | null> {
  try {
    const cliHighlight = await import('cli-highlight')
    // cache hit — cli-highlight already loaded highlight.js
    const highlightJs = await import('highlight.js')
    // highlight.js is CommonJS-compatible: its ESM namespace exposes the
    // public registry on `default`, not as named exports. The old named lookup
    // was undefined at runtime, so telemetry always reported "unknown".
    loadedGetLanguage = highlightJs.default.getLanguage.bind(
      highlightJs.default,
    )
    return {
      highlight: cliHighlight.highlight,
      supportsLanguage: cliHighlight.supportsLanguage,
    }
  } catch (error) {
    // Silent for a long time: cli-highlight was imported but never declared in
    // package.json, so this threw on every run and every code block rendered
    // as plain text with no indication why. A degraded render has to say so.
    logError(
      `Syntax highlighting is unavailable: ${error instanceof Error ? error.message : String(error)}. Code will render unstyled.`,
    )
    return null
  }
}

export function getCliHighlightPromise(): Promise<CliHighlight | null> {
  cliHighlightPromise ??= loadCliHighlight()
  return cliHighlightPromise
}

/**
 * eg. "foo/bar.ts" → "TypeScript". Awaits the shared cli-highlight load,
 * then reads highlight.js's language registry. All callers are telemetry
 * (OTel counter attributes, permission-dialog unary events) — none block
 * on this, they fire-and-forget or the consumer already handles Promise<string>.
 */
export async function getLanguageName(file_path: string): Promise<string> {
  await getCliHighlightPromise()
  const ext = extname(file_path).slice(1)
  if (!ext) return 'unknown'
  return loadedGetLanguage?.(ext)?.name ?? 'unknown'
}
