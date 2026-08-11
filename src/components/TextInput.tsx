// @ts-nocheck
import { feature } from 'bun:bundle';
import chalk from 'chalk';
import React, { useContext, useMemo, useRef, useState } from 'react';
import { useVoiceState } from '../context/voice.js';
import { useClipboardImageHint } from '../hooks/useClipboardImageHint.js';
import { useSettings } from '../hooks/useSettings.js';
import { useTextInput } from '../hooks/useTextInput.js';
import { TerminalSizeContext } from '../ink/components/TerminalSizeContext.js';
import { Box, color, useAnimationFrame, useTerminalFocus, useTheme } from '../ink.js';
import type { BaseTextInputProps } from '../types/textInputTypes.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { isScreenReaderMode } from '../utils/screenReader.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { BaseTextInput } from './BaseTextInput.js';
import { hueToRgb } from './Spinner/utils.js';

// Block characters for waveform bars: space (silent) + 8 rising block elements.
const BARS = ' \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';

// Mini waveform cursor width
const CURSOR_WAVEFORM_WIDTH = 1;

// Smoothing factor (0 = instant, 1 = frozen). Applied as EMA to
// smooth both rises and falls for a steady, non-jittery bar.
const SMOOTH = 0.7;

// Boost factor for audio levels — computeLevel normalizes with a
// conservative divisor (rms/2000), so normal speech sits around
// 0.3-0.5. This multiplier lets the bar use the full range.
const LEVEL_BOOST = 1.8;

// Raw audio level threshold (pre-boost) below which the cursor is
// grey. computeLevel returns sqrt(rms/2000), so ambient mic noise
// typically sits at 0.05-0.15. Speech starts around 0.2+.
const SILENCE_THRESHOLD = 0.15;
export type Props = BaseTextInputProps & {
  highlights?: TextHighlight[];
};
// Reserve room for the surrounding label/prompt so a caller that omits an
// explicit width still wraps at something usable rather than the terminal edge.
const IMPLICIT_WIDTH_GUTTER = 4;
const IMPLICIT_WIDTH_FALLBACK = 80;

/**
 * Width used when a call site omits `columns`. Reads the live terminal size
 * when one is available and degrades to a conventional 80 columns otherwise,
 * so this never reintroduces the 1-column wrap.
 */
export function resolveImplicitInputColumns(terminalColumns: number | undefined): number {
  const base = Number.isFinite(terminalColumns) && (terminalColumns as number) > 0 ? (terminalColumns as number) : IMPLICIT_WIDTH_FALLBACK;
  return Math.max(2, Math.floor(base) - IMPLICIT_WIDTH_GUTTER);
}

/** True when `columns` is usable as a wrap width. */
export function hasUsableColumns(columns: unknown): boolean {
  return typeof columns === 'number' && Number.isFinite(columns) && columns >= 2;
}
export default function TextInput(props: Props): React.ReactNode {
  const [theme] = useTheme();
  const isTerminalFocused = useTerminalFocus();
  const terminalSize = useContext(TerminalSizeContext);
  // `columns` is declared required, but call sites in .tsx files carrying
  // `@ts-nocheck` can omit it. An absent width reached normalizeCursorColumns(),
  // which floors non-finite input at 2 and yields a 1-column MeasuredText —
  // rendering one grapheme per line. Fall back to the live terminal width.
  const resolvedColumns = hasUsableColumns(props.columns) ? props.columns : resolveImplicitInputColumns(terminalSize?.columns);
  // Offset is normally lifted into the parent. When a call site omits the
  // pair, keep it internal: an undefined offset pinned the cursor at 0 (every
  // keystroke inserted at the head, reversing the value) and an undefined
  // setter threw on each accepted key.
  const [internalOffset, setInternalOffset] = useState(0);
  const hasExternalOffset = typeof props.onChangeCursorOffset === 'function';
  const resolvedOffset = hasExternalOffset ? props.cursorOffset : internalOffset;
  const resolvedOnOffsetChange = hasExternalOffset ? props.onChangeCursorOffset : setInternalOffset;
  // Hoisted to mount-time — this component re-renders on every keystroke.
  const accessibilityEnabled = useMemo(() => isEnvTruthy(process.env.UR_CODE_ACCESSIBILITY), []);
  const settings = useSettings();
  const reducedMotion = (settings.prefersReducedMotion ?? false) || isScreenReaderMode();
  const voiceState = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s => s.voiceState) : 'idle' as const;
  const isVoiceRecording = voiceState === 'recording';
  const audioLevels = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s_0 => s_0.voiceAudioLevels) : [];
  const smoothedRef = useRef<number[]>(new Array(CURSOR_WAVEFORM_WIDTH).fill(0));
  const needsAnimation = isVoiceRecording && !reducedMotion;
  const [animRef, animTime] = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAnimationFrame(needsAnimation ? 50 : null) : [() => {}, 0];

  // Show hint when terminal regains focus and clipboard has an image
  useClipboardImageHint(isTerminalFocused, !!props.onImagePaste);

  // Cursor invert function: mini waveform during voice recording,
  // standard chalk.inverse otherwise. No warmup pulse — the ~120ms
  // warmup window is too short for a 1s-period pulse to register, and
  // driving TextInput re-renders at 50ms during warmup (while spaces
  // are simultaneously arriving every 30-80ms) causes visible stutter.
  const canShowCursor = isTerminalFocused && !accessibilityEnabled;
  let invert: (text: string) => string;
  if (!canShowCursor) {
    invert = (text: string) => text;
  } else if (isVoiceRecording && !reducedMotion) {
    // Single-bar waveform from the latest audio level
    const smoothed = smoothedRef.current;
    const raw = audioLevels.length > 0 ? audioLevels[audioLevels.length - 1] ?? 0 : 0;
    const target = Math.min(raw * LEVEL_BOOST, 1);
    smoothed[0] = (smoothed[0] ?? 0) * SMOOTH + target * (1 - SMOOTH);
    const displayLevel = smoothed[0] ?? 0;
    const barIndex = Math.max(1, Math.min(Math.round(displayLevel * (BARS.length - 1)), BARS.length - 1));
    const isSilent = raw < SILENCE_THRESHOLD;
    const hue = animTime / 1000 * 90 % 360;
    const {
      r,
      g,
      b
    } = isSilent ? {
      r: 128,
      g: 128,
      b: 128
    } : hueToRgb(hue);
    invert = () => chalk.rgb(r, g, b)(BARS[barIndex]!);
  } else {
    invert = chalk.inverse;
  }
  const textInputState = useTextInput({
    value: props.value,
    onChange: props.onChange,
    onSubmit: props.onSubmit,
    onExit: props.onExit,
    onExitMessage: props.onExitMessage,
    onHistoryReset: props.onHistoryReset,
    onHistoryUp: props.onHistoryUp,
    onHistoryDown: props.onHistoryDown,
    onClearInput: props.onClearInput,
    focus: props.focus,
    mask: props.mask,
    multiline: props.multiline,
    cursorChar: props.showCursor ? ' ' : '',
    highlightPastedText: props.highlightPastedText,
    invert,
    themeText: color('text', theme),
    columns: resolvedColumns,
    maxVisibleLines: props.maxVisibleLines,
    onImagePaste: props.onImagePaste,
    disableCursorMovementForUpDownKeys: props.disableCursorMovementForUpDownKeys,
    disableEscapeDoublePress: props.disableEscapeDoublePress,
    externalOffset: resolvedOffset,
    onOffsetChange: resolvedOnOffsetChange,
    inputFilter: props.inputFilter,
    inlineGhostText: props.inlineGhostText,
    dim: chalk.dim
  });
  return <Box ref={animRef}>
      <BaseTextInput inputState={textInputState} terminalFocus={isTerminalFocused} highlights={props.highlights} invert={invert} hidePlaceholderText={isVoiceRecording} {...props} columns={resolvedColumns} cursorOffset={resolvedOffset} onChangeCursorOffset={resolvedOnOffsetChange} />
    </Box>;
}
