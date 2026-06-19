import * as React from 'react';
import { Box } from '../../ink.js';
import { Select } from '../CustomSelect/index.js';
import { URPromptDialog } from './URPromptDialog.js';

export type URChoice<T extends string = string> = {
  label: string;
  value: T;
  description?: string;
  disabled?: boolean;
};

export type URChoicePromptProps<T extends string = string> = {
  title?: string;
  message?: React.ReactNode;
  choices: URChoice<T>[];
  defaultValue?: T;
  onSubmit: (value: T) => void;
  onCancel?: () => void;
};

export function URChoicePrompt<T extends string = string>({
  title,
  message,
  choices,
  defaultValue,
  onSubmit,
  onCancel,
}: URChoicePromptProps<T>): React.ReactNode {
  return (
    <URPromptDialog title={title} message={message}>
      <Box marginTop={message != null ? 1 : 0} flexDirection="column">
        <Select
          options={choices}
          defaultValue={defaultValue}
          onChange={(value: T) => onSubmit(value)}
          onCancel={onCancel}
        />
      </Box>
    </URPromptDialog>
  );
}
