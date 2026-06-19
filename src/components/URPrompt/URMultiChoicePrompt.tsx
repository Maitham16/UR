import * as React from 'react';
import { Box } from '../../ink.js';
import { SelectMulti } from '../CustomSelect/index.js';
import { URPromptDialog } from './URPromptDialog.js';
import type { URChoice } from './URChoicePrompt.js';

export type URMultiChoicePromptProps<T extends string = string> = {
  title?: string;
  message?: React.ReactNode;
  choices: URChoice<T>[];
  defaultValues?: T[];
  submitButtonText?: string;
  onSubmit: (values: T[]) => void;
  onCancel: () => void;
};

export function URMultiChoicePrompt<T extends string = string>({
  title,
  message,
  choices,
  defaultValues,
  submitButtonText,
  onSubmit,
  onCancel,
}: URMultiChoicePromptProps<T>): React.ReactNode {
  return (
    <URPromptDialog title={title} message={message}>
      <Box marginTop={message != null ? 1 : 0} flexDirection="column">
        <SelectMulti
          options={choices}
          defaultValue={defaultValues}
          submitButtonText={submitButtonText}
          onSubmit={(values: T[]) => onSubmit(values)}
          onCancel={onCancel}
        />
      </Box>
    </URPromptDialog>
  );
}
