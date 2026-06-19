import * as React from 'react';
import { Box, Text } from '../../ink.js';

export type URPromptDialogProps = {
  title?: string;
  message?: React.ReactNode;
  children?: React.ReactNode;
};

export function URPromptDialog({
  title,
  message,
  children,
}: URPromptDialogProps): React.ReactNode {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="ur" paddingX={1}>
      {title ? (
        <Text bold color="ur">
          {title}
        </Text>
      ) : null}
      {message != null
        ? typeof message === 'string'
          ? <Text>{message}</Text>
          : message
        : null}
      {children}
    </Box>
  );
}
