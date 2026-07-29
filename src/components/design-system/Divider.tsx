import React from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import wrapText from '../../ink/wrap-text.js';
import { Ansi, Text } from '../../ink.js';
import sliceAnsi from '../../utils/sliceAnsi.js';
import type { Theme } from '../../utils/theme.js';
type DividerProps = {
  /**
   * Width of the divider in characters.
   * Defaults to terminal width.
   */
  width?: number;

  /**
   * Theme color for the divider.
   * If not provided, dimColor is used.
   */
  color?: keyof Theme;

  /**
   * Character to use for the divider line.
   * @default '─'
   */
  char?: string;

  /**
   * Padding to subtract from the width (e.g., for indentation).
   * @default 0
   */
  padding?: number;

  /**
   * Title shown in the middle of the divider.
   * May contain ANSI codes (e.g., chalk-styled text).
   *
   * @example
   * // ─────────── Title ───────────
   * <Divider title="Title" />
   */
  title?: string;
};

export type DividerParts = {
  left: string;
  title: string | undefined;
  right: string;
};

function fillToWidth(char: string, width: number): string {
  if (width <= 0) return '';

  const unit = stringWidth(char) > 0 ? char : '─';
  const unitWidth = stringWidth(unit);
  const repeated = unit.repeat(Math.ceil(width / unitWidth));
  let result = sliceAnsi(repeated, 0, width);

  // sliceAnsi keeps a wide glyph that straddles the boundary. Dividers have
  // a strict layout contract, so drop that glyph and pad the spare cell.
  if (stringWidth(result) > width) {
    result = sliceAnsi(repeated, 0, Math.max(0, width - 1));
  }

  return result + ' '.repeat(Math.max(0, width - stringWidth(result)));
}

/**
 * Compute a single-line divider that is guaranteed to fit `width` cells.
 * ANSI-styled titles are truncated without breaking their escape sequences.
 */
export function getDividerParts(
  width: number,
  char: string,
  title?: string,
): DividerParts {
  const safeWidth = Number.isFinite(width)
    ? Math.max(0, Math.floor(width))
    : 0;

  if (!title || safeWidth < 3) {
    return {
      left: fillToWidth(char, safeWidth),
      title: undefined,
      right: '',
    };
  }

  const fittedTitle = wrapText(title, safeWidth - 2, 'truncate-end');
  const sideWidth = Math.max(0, safeWidth - stringWidth(fittedTitle) - 2);
  const leftWidth = Math.floor(sideWidth / 2);

  return {
    left: fillToWidth(char, leftWidth),
    title: fittedTitle,
    right: fillToWidth(char, sideWidth - leftWidth),
  };
}

/**
 * A horizontal divider line.
 *
 * @example
 * // Full-width dimmed divider
 * <Divider />
 *
 * @example
 * // Colored divider
 * <Divider color="suggestion" />
 *
 * @example
 * // Fixed width
 * <Divider width={40} />
 *
 * @example
 * // Full width minus padding (for indented content)
 * <Divider padding={4} />
 *
 * @example
 * // With centered title
 * <Divider title="3 new messages" />
 */
export function Divider({
  width,
  color,
  char = '─',
  padding = 0,
  title,
}: DividerProps): React.ReactNode {
  const { columns: terminalWidth } = useTerminalSize();
  const parts = getDividerParts(
    Math.max(0, (width ?? terminalWidth) - padding),
    char,
    title,
  );
  const dimColor = !color;

  if (parts.left === '' && parts.title === undefined && parts.right === '') {
    return null;
  }

  if (parts.title !== undefined) {
    return (
      <Text color={color} dimColor={dimColor}>
        {parts.left} <Text dimColor><Ansi>{parts.title}</Ansi></Text>{' '}
        {parts.right}
      </Text>
    );
  }

  return (
    <Text color={color} dimColor={dimColor}>
      {parts.left}
    </Text>
  );
}
