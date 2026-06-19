import * as React from 'react';
import { URChoicePrompt } from './URChoicePrompt.js';

export type URApprovalChoice = 'approve' | 'reject';

export type URApprovalPromptProps = {
  title?: string;
  message?: React.ReactNode;
  approveLabel?: string;
  rejectLabel?: string;
  defaultValue?: URApprovalChoice;
  onApprove: () => void;
  onReject: () => void;
  onCancel?: () => void;
};

export function URApprovalPrompt({
  title = 'Approval required',
  message,
  approveLabel = 'Yes, allow',
  rejectLabel = 'No, deny',
  defaultValue = 'approve',
  onApprove,
  onReject,
  onCancel,
}: URApprovalPromptProps): React.ReactNode {
  return (
    <URChoicePrompt<URApprovalChoice>
      title={title}
      message={message}
      defaultValue={defaultValue}
      choices={[
        { label: approveLabel, value: 'approve' },
        { label: rejectLabel, value: 'reject' },
      ]}
      onSubmit={value => (value === 'approve' ? onApprove() : onReject())}
      onCancel={onCancel}
    />
  );
}
