import type { ToolResultBlockParam } from '@urhq-ai/sdk/resources/messages/messages.mjs';
import * as React from 'react';
import { stripUnderlineAnsi } from 'src/components/shell/OutputLine.js';
import { extractTag } from 'src/utils/messages.js';
import { removeSandboxViolationTags } from 'src/utils/sandbox/sandbox-ui-utils.js';
import { Box, Text } from '../ink.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { countCharInString } from '../utils/stringUtils.js';
import { MessageResponse } from './MessageResponse.js';
const MAX_RENDERED_LINES = 10;
const INPUT_VALIDATION_ERROR_PREFIX = 'InputValidationError: ';
type Props = {
  result: ToolResultBlockParam['content'];
  verbose: boolean;
};

export function formatFallbackToolUseError(
  result: ToolResultBlockParam['content'],
  verbose: boolean,
): {
  error: string;
  hiddenLineCount: number;
  showDetailsHint: boolean;
} {
  if (typeof result !== 'string') {
    return {
      error: 'Tool execution failed',
      hiddenLineCount: 0,
      showDetailsHint: false,
    };
  }

  const extractedError = extractTag(result, 'tool_use_error') ?? result;
  // Remove sandbox_violations tags from error display (UR still sees them in the tool result).
  const withoutSandboxViolations = removeSandboxViolationTags(extractedError);
  // Strip <error> tags but keep their contents (tags are for the model, not the UI).
  const withoutErrorTags = withoutSandboxViolations.replace(/<\/?error>/g, '');
  const trimmed = withoutErrorTags.trim();
  const isInputValidationError = trimmed.includes(INPUT_VALIDATION_ERROR_PREFIX);
  let fullError: string;

  if (trimmed.startsWith('Error: ') || trimmed.startsWith('Cancelled: ')) {
    fullError = trimmed;
  } else {
    fullError = `Error: ${trimmed}`;
  }

  const hiddenLineCount = Math.max(
    0,
    countCharInString(fullError, '\n') + 1 - MAX_RENDERED_LINES,
  );

  return {
    error: !verbose && isInputValidationError
      ? 'Invalid tool parameters'
      : fullError,
    hiddenLineCount,
    showDetailsHint: !verbose && (isInputValidationError || hiddenLineCount > 0),
  };
}

export function FallbackToolUseErrorMessage({
  result,
  verbose,
}: Props): React.ReactNode {
  const transcriptShortcut = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  const { error, hiddenLineCount, showDetailsHint } =
    formatFallbackToolUseError(result, verbose);
  const visibleError = stripUnderlineAnsi(
    verbose
      ? error
      : error.split('\n').slice(0, MAX_RENDERED_LINES).join('\n'),
  );

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">{visibleError}</Text>
        {showDetailsHint && (
          <Box>
            <Text dimColor>
              {hiddenLineCount > 0
                ? `… +${hiddenLineCount} ${hiddenLineCount === 1 ? 'line' : 'lines'} (`
                : 'Details hidden ('}
            </Text>
            <Text dimColor bold>
              {transcriptShortcut}
            </Text>
            <Text> </Text>
            <Text dimColor>to see details)</Text>
          </Box>
        )}
      </Box>
    </MessageResponse>
  );
}
