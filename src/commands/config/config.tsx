import * as React from 'react';
import { useEffect } from 'react';
import { Settings } from '../../components/Settings/Settings.js';
import { Text } from '../../ink.js';
import { setScreenReaderRendering } from '../../ink/root.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { disableScreenReaderMode, enableScreenReaderMode } from '../../utils/screenReader.js';
import { applyConfigAssignments, CONFIG_ASSIGNMENT_HELP, parseConfigAssignments } from './configAssignments.js';

function ConfigResult({ message, onDone }: { message: string; onDone: (message: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(message), 0);
    return () => clearTimeout(timer);
  }, [message, onDone]);
  return <Text>{message}</Text>;
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const input = (args ?? '').trim();
  if (input === '') return <Settings onClose={onDone} context={context} defaultTab="Config" />;
  if (input === '--help' || input === '-h' || input === 'help') {
    return <ConfigResult message={CONFIG_ASSIGNMENT_HELP} onDone={onDone} />;
  }
  const parsed = parseConfigAssignments(input);
  if (parsed.error) {
    return <ConfigResult message={`${parsed.error}\n\n${CONFIG_ASSIGNMENT_HELP}`} onDone={onDone} />;
  }

  const result = applyConfigAssignments(parsed.assignments, {
    thinking(value) {
        context.setAppState(previous => ({ ...previous, thinkingEnabled: value }));
    },
    screenReader(value) {
        if (value) enableScreenReaderMode(); else disableScreenReaderMode();
        setScreenReaderRendering(value);
        context.setAppState(previous => ({
          ...previous,
          settings: { ...previous.settings, screenReaderMode: value }
        }));
    },
    reducedMotion(value) {
        context.setAppState(previous => ({ ...previous, settings: { ...previous.settings, prefersReducedMotion: value } }));
    },
    verbose(value) {
        context.setAppState(previous => ({ ...previous, verbose: value }));
    },
  });
  if (result.error) return <ConfigResult message={result.error} onDone={onDone} />;
  return <ConfigResult message={`Updated ${result.applied.join(', ')}.`} onDone={onDone} />;
};
