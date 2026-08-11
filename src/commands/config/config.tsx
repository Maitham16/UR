import * as React from 'react';
import { useEffect } from 'react';
import { Settings } from '../../components/Settings/Settings.js';
import { Text } from '../../ink.js';
import { setScreenReaderRendering } from '../../ink/root.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { saveGlobalConfig } from '../../utils/config.js';
import { disableScreenReaderMode, enableScreenReaderMode } from '../../utils/screenReader.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
import { CONFIG_ASSIGNMENT_HELP, parseConfigAssignments } from './configAssignments.js';

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

  const applied: string[] = [];
  for (const assignment of parsed.assignments) {
    switch (assignment.key) {
      case 'thinking': {
        const value = assignment.value as boolean;
        const result = updateSettingsForSource('userSettings', { alwaysThinkingEnabled: value ? undefined : false });
        if (result.error) return <ConfigResult message={`Could not update thinking: ${result.error.message}`} onDone={onDone} />;
        context.setAppState(previous => ({ ...previous, thinkingEnabled: value }));
        applied.push(`thinking=${value}`);
        break;
      }
      case 'screenReader': {
        const value = assignment.value as boolean;
        const result = updateSettingsForSource('localSettings', { screenReaderMode: value });
        if (result.error) return <ConfigResult message={`Could not update screen reader mode: ${result.error.message}`} onDone={onDone} />;
        if (value) enableScreenReaderMode(); else disableScreenReaderMode();
        setScreenReaderRendering(value);
        context.setAppState(previous => ({
          ...previous,
          settings: { ...previous.settings, screenReaderMode: value }
        }));
        applied.push(`screenReader=${value}`);
        break;
      }
      case 'reducedMotion': {
        const value = assignment.value as boolean;
        const result = updateSettingsForSource('localSettings', { prefersReducedMotion: value });
        if (result.error) return <ConfigResult message={`Could not update reduced motion: ${result.error.message}`} onDone={onDone} />;
        context.setAppState(previous => ({ ...previous, settings: { ...previous.settings, prefersReducedMotion: value } }));
        applied.push(`reducedMotion=${value}`);
        break;
      }
      case 'verbose': {
        const value = assignment.value as boolean;
        const result = updateSettingsForSource('userSettings', { verbose: value });
        if (result.error) return <ConfigResult message={`Could not update verbose output: ${result.error.message}`} onDone={onDone} />;
        context.setAppState(previous => ({ ...previous, verbose: value }));
        applied.push(`verbose=${value}`);
        break;
      }
      case 'autoCompact': {
        const value = assignment.value as boolean;
        saveGlobalConfig(previous => ({ ...previous, autoCompactEnabled: value }));
        applied.push(`autoCompact=${value}`);
        break;
      }
      case 'editor': {
        const value = assignment.value as 'normal' | 'vim';
        saveGlobalConfig(previous => ({ ...previous, editorMode: value }));
        applied.push(`editor=${value}`);
        break;
      }
      case 'vimEscape': {
        const value = assignment.value as string;
        saveGlobalConfig(previous => ({
          ...previous,
          vimInsertModeEscapeSequence: value || undefined,
        }));
        applied.push(`vimEscape=${value || 'off'}`);
        break;
      }
    }
  }
  return <ConfigResult message={`Updated ${applied.join(', ')}.`} onDone={onDone} />;
};
