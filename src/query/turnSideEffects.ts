/**
 * Opt-in side effects that run once a turn finishes.
 *
 * Both hang off turn completion rather than the streaming path: neither should
 * be able to delay a token, and both must be able to fail without touching the
 * conversation. Everything here is best-effort and swallows its own errors —
 * a broken synthesiser or an unreadable memory file must not end a session.
 */

import { proposeMemories } from '../memdir/extractFacts.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { speak, type SpeechExec, type SpeechPlatform } from '../voice/speak.js'

export type TurnSideEffectSettings = {
  /** Read assistant replies aloud. Off by default. */
  speakResponses: boolean
  voice?: string
  rate?: number
  /** Surface memory candidates after a turn. Off by default. */
  suggestMemories: boolean
  minConfidence: number
}

export function resolveTurnSideEffects(
  settings = getInitialSettings(),
): TurnSideEffectSettings {
  const voiceCfg =
    (settings as { voice?: Record<string, unknown> }).voice ?? {}
  const memoryCfg =
    (settings as { memory?: Record<string, unknown> }).memory ?? {}
  const rate = voiceCfg.rate
  const minConfidence = memoryCfg.suggestMinConfidence
  return {
    speakResponses: voiceCfg.speakResponses === true,
    voice: typeof voiceCfg.name === 'string' ? voiceCfg.name : undefined,
    rate:
      typeof rate === 'number' && Number.isFinite(rate) && rate > 0
        ? Math.floor(rate)
        : undefined,
    suggestMemories: memoryCfg.suggest === true,
    minConfidence:
      typeof minConfidence === 'number' &&
      minConfidence > 0 &&
      minConfidence <= 1
        ? minConfidence
        : 0.75,
  }
}

/**
 * Speak an assistant reply when the setting is on.
 *
 * Deliberately fire-and-forget: awaiting synthesis would block the prompt from
 * returning for as long as the text takes to read aloud.
 */
export function maybeSpeakResponse(
  text: string,
  exec: SpeechExec,
  config: TurnSideEffectSettings,
  platform: SpeechPlatform = process.platform as SpeechPlatform,
): boolean {
  if (!config.speakResponses || !text.trim()) return false
  void speak(text, exec, {
    platform,
    voice: config.voice,
    rate: config.rate,
  }).catch(() => {
    /* a missing synthesiser degrades to silence */
  })
  return true
}

/**
 * Memory candidates from the user's turn, formatted for display.
 *
 * Returns null when the feature is off or nothing qualifies, so the caller can
 * skip rendering entirely rather than printing an empty section. Nothing is
 * persisted here — `/remember` remains the only writer.
 */
export function buildMemorySuggestion(
  userText: string,
  knownMemories: string[],
  config: TurnSideEffectSettings,
): string | null {
  if (!config.suggestMemories) return null
  const facts = proposeMemories(userText, knownMemories, config.minConfidence)
  if (facts.length === 0) return null
  const lines = facts.map(
    fact => `  · ${fact.text}  [${fact.type}, ${fact.confidence.toFixed(2)}]`,
  )
  return [
    `Worth remembering? (${facts.length})`,
    ...lines,
    'Keep one with /remember <text>, or ignore this.',
  ].join('\n')
}
