/**
 * Palette for the fixed command deck and status rail.
 *
 * Deliberately separate from utils/theme.ts. That theme is shared by every
 * screen, is @ts-nocheck'd, and defines `ur` as the single brand colour used
 * for borders, wordmarks and emphasis alike — which is what produced the
 * orange-dominant banner this design replaces. Redefining `ur` there would
 * restyle unrelated screens, which is out of scope.
 *
 * Roles, not shades. Callers ask for `focus` or `brand`, never a hex, so the
 * rules below survive a future palette change:
 *
 *   brand    bronze  — UR identity and structural accents only
 *   accent   lapis   — focus, selection, context usage, active controls
 *   success  green   — healthy state only, never decoration
 *   warning  amber   — updates and soft alerts
 *   error    red     — failures
 */
export const DECK_PALETTE = {
  background: '#080B0E',
  surface: '#0E1318',
  surfaceSecondary: '#141A20',
  border: '#29323A',
  brand: '#B77A36',
  brandHighlight: '#D19A52',
  accent: '#4E87BE',
  focus: '#68A3D6',
  text: '#DDD9D0',
  textSecondary: '#9AA3AA',
  muted: '#66717A',
  success: '#7FA46C',
  warning: '#C99A4B',
  error: '#C66B61',
} as const

export type DeckColor = keyof typeof DECK_PALETTE

/**
 * Terminals without truecolor render hex as the nearest ANSI colour, which
 * collapses bronze and amber into the same yellow and loses the distinction
 * the palette depends on. Callers that must stay legible there use these
 * names instead.
 */
export const DECK_FALLBACK: Record<DeckColor, string> = {
  background: 'black',
  surface: 'black',
  surfaceSecondary: 'blackBright',
  border: 'blackBright',
  brand: 'yellow',
  brandHighlight: 'yellowBright',
  accent: 'blue',
  focus: 'blueBright',
  text: 'white',
  textSecondary: 'whiteBright',
  muted: 'blackBright',
  success: 'green',
  warning: 'yellow',
  error: 'red',
}

/** Width bands the deck and rail lay out against. */
export type DeckWidthMode = 'minimal' | 'compact' | 'full'

/**
 * 80 columns is the standard minimum terminal; below it the three-column deck
 * cannot hold its labels without wrapping, which the spec forbids outright.
 * 120 is where miniature metric bars and the full status row both fit.
 */
export const DECK_BREAKPOINTS = {
  compact: 80,
  full: 120,
} as const

export function deckWidthMode(columns: number): DeckWidthMode {
  if (columns >= DECK_BREAKPOINTS.full) return 'full'
  if (columns >= DECK_BREAKPOINTS.compact) return 'compact'
  return 'minimal'
}
