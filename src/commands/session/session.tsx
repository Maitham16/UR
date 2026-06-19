import * as React from 'react';
import { Pane } from '../../components/design-system/Pane.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';

type Props = {
  onDone: () => void;
};

function SessionInfo({ onDone }: Props): React.ReactNode {
  const remoteSessionUrl = useAppState(s => s.remoteSessionUrl);
  useKeybinding('confirm:no', onDone, { context: 'Confirmation' });

  if (!remoteSessionUrl) {
    return (
      <Pane>
        <Text color="warning">
          Not in remote mode. Start with `ur --remote` to use this command.
        </Text>
        <Text dimColor={true}>(press esc to close)</Text>
      </Pane>
    );
  }

  return (
    <Pane>
      <Box marginBottom={1}>
        <Text bold={true}>Remote session</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor={true}>Open in browser: </Text>
        <Text color="ide">{remoteSessionUrl}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor={true}>(press esc to close)</Text>
      </Box>
    </Pane>
  );
}

export const call: LocalJSXCommandCall = async onDone => {
  return <SessionInfo onDone={onDone} />;
};
